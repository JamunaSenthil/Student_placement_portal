"""
Student Placement Portal - Flask Backend
=========================================
3 Roles:
  student - fills own profile, uploads resume, views placement status
  admin   - manages companies, views dashboard, oversees all
  company - views eligible students, shortlists, schedules interviews, places
"""

import math
import os
import re
import uuid
from functools import wraps

from bson import ObjectId
from flask import (Flask, jsonify, redirect, render_template,
                   request, session, url_for, send_from_directory)
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import OperationFailure
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = "spp_secret_key_change_in_prod"
CORS(app, supports_credentials=True)

# ── File upload config ────────────────────────────────────────────
UPLOAD_FOLDER   = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
ALLOWED_EXTENSIONS = {'pdf'}
MAX_FILE_MB     = 5
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_MB * 1024 * 1024

# ── MongoDB ───────────────────────────────────────────────────────
client    = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=3000)
db        = client["placementDB"]
col_students  = db["students"]
col_companies = db["companies"]
col_users     = db["users"]
col_actions   = db["placement_actions"]  # shortlist / interview / place records

# ── Indexes ───────────────────────────────────────────────────────
try:
    col_students.create_index([("rollNo", ASCENDING)], unique=True)
except OperationFailure:
    col_students.create_index([("rollNo", ASCENDING)])

try:
    col_companies.create_index([("name", ASCENDING)], unique=True)
except OperationFailure:
    col_companies.create_index([("name", ASCENDING)])

col_users.create_index([("username", ASCENDING)], unique=True)

# ── Seed default admin ────────────────────────────────────────────
if not col_users.find_one({"role": "admin"}):
    col_users.insert_one({
        "username": "admin",
        "password": "admin123",
        "role":     "admin",
        "name":     "Placement Officer",
    })


# ── Helpers / Decorators ──────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            if request.is_json:
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if "user" not in session:
                if request.is_json:
                    return jsonify({"error": "Unauthorized"}), 401
                return redirect(url_for("login_page"))
            if session.get("role") not in roles:
                if request.is_json:
                    return jsonify({"error": "Forbidden"}), 403
                return redirect(url_for("login_page"))
            return f(*args, **kwargs)
        return decorated
    return decorator


def serialize(doc):
    if doc:
        doc["_id"] = str(doc["_id"])
    return doc


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


PLACEMENT_STATUSES = [
    "Registered", "Profile Incomplete", "Shortlisted",
    "Interview Scheduled", "Placed", "Rejected"
]


# ════════════════════════════════════════════════════════════════
#  AUTH
# ════════════════════════════════════════════════════════════════

@app.route("/")
def root():
    if "user" not in session:
        return redirect(url_for("login_page"))
    role = session.get("role")
    if role == "admin":    return redirect(url_for("admin_page"))
    if role == "company":  return redirect(url_for("company_page"))
    if role == "student":  return redirect(url_for("student_page"))
    return redirect(url_for("login_page"))


@app.route("/loginPage")
def login_page():
    if "user" in session:
        return redirect(url_for("root"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login():
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    role_req = (data.get("role") or "").strip()

    if not username or not password or role_req not in ("admin", "company", "student"):
        return jsonify({"success": False, "message": "All fields are required."}), 400

    user = col_users.find_one({"username": username, "role": role_req})
    if not user or user["password"] != password:
        return jsonify({"success": False,
                        "message": "Invalid credentials or wrong role selected."}), 401

    session["user"]       = username
    session["role"]       = user["role"]
    session["name"]       = user.get("name", username)
    session["roll_no"]    = user.get("rollNo", "")
    session["company_id"] = str(user.get("companyId", ""))
    session.permanent     = True

    redirects = {"admin": "/admin", "company": "/company", "student": "/student"}
    return jsonify({"success": True, "redirect": redirects[role_req]})


@app.route("/logout")
@login_required
def logout():
    session.clear()
    return redirect(url_for("login_page"))


# ════════════════════════════════════════════════════════════════
#  PAGES
# ════════════════════════════════════════════════════════════════

@app.route("/admin")
@role_required("admin")
def admin_page():
    return render_template("admin.html", username=session.get("name", "Admin"))


@app.route("/company")
@role_required("company")
def company_page():
    return render_template("company.html",
                           username=session.get("name", "Company"),
                           company_id=session.get("company_id", ""))


@app.route("/student")
@role_required("student")
def student_page():
    return render_template("student.html",
                           name=session.get("name", "Student"),
                           username=session.get("user", ""))


# ════════════════════════════════════════════════════════════════
#  RESUME FILE SERVING
# ════════════════════════════════════════════════════════════════

@app.route("/resume/<filename>")
@login_required
def serve_resume(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ════════════════════════════════════════════════════════════════
#  STUDENT API — own profile & resume
# ════════════════════════════════════════════════════════════════

@app.route("/api/student/profile", methods=["GET"])
@role_required("student")
def student_get_profile():
    roll_no = _get_student_roll()
    if not roll_no:
        return jsonify({"success": False, "message": "Roll number not found in session."}), 400

    doc = col_students.find_one({"rollNo": roll_no})
    if not doc:
        # Return empty profile template
        return jsonify({"success": True, "student": None,
                        "message": "Profile not created yet."})
    return jsonify({"success": True, "student": serialize(doc)})


@app.route("/api/student/profile", methods=["POST"])
@role_required("student")
def student_save_profile():
    """Student saves/updates their own profile details."""
    roll_no = _get_student_roll()
    if not roll_no:
        return jsonify({"success": False, "message": "Session error."}), 400

    data = request.get_json(silent=True) or {}

    name       = (data.get("name") or "").strip()
    department = (data.get("department") or "").strip()
    email      = (data.get("email") or "").strip()
    phone      = (data.get("phone") or "").strip()
    skills     = (data.get("skills") or "").strip()
    linkedin   = (data.get("linkedin") or "").strip()
    cgpa_raw   = data.get("cgpa", "")

    errors = []
    if not name:       errors.append("Name is required.")
    if not department: errors.append("Department is required.")
    if not email or not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        errors.append("Valid email is required.")

    try:
        cgpa = round(float(cgpa_raw), 2)
        if not (0 <= cgpa <= 10): raise ValueError
    except (ValueError, TypeError):
        errors.append("CGPA must be between 0.0 and 10.0.")
        cgpa = 0

    if errors:
        return jsonify({"success": False, "message": ", ".join(errors)}), 400

    existing = col_students.find_one({"rollNo": roll_no})
    update_data = {
        "rollNo":     roll_no,
        "name":       name,
        "department": department,
        "email":      email.lower(),
        "phone":      phone,
        "skills":     skills,
        "linkedin":   linkedin,
        "cgpa":       cgpa,
    }

    if existing:
        # Keep existing resume and placement status
        update_data["placementStatus"] = existing.get("placementStatus", "Registered")
        update_data["resumeFile"]      = existing.get("resumeFile", "")
        update_data["placedCompany"]   = existing.get("placedCompany", "")
        update_data["packageLPA"]      = existing.get("packageLPA", 0)
        col_students.update_one({"rollNo": roll_no}, {"$set": update_data})
    else:
        update_data["placementStatus"] = "Registered"
        update_data["resumeFile"]      = ""
        update_data["placedCompany"]   = ""
        update_data["packageLPA"]      = 0
        col_students.insert_one(update_data)

    # Update name in users table
    col_users.update_one({"username": session["user"]},
                         {"$set": {"name": name}})
    session["name"] = name

    doc = col_students.find_one({"rollNo": roll_no})
    return jsonify({"success": True, "message": "Profile saved successfully.",
                    "student": serialize(doc)})


@app.route("/api/student/resume", methods=["POST"])
@role_required("student")
def student_upload_resume():
    """Student uploads their resume PDF."""
    roll_no = _get_student_roll()
    if not roll_no:
        return jsonify({"success": False, "message": "Session error."}), 400

    if "resume" not in request.files:
        return jsonify({"success": False, "message": "No file provided."}), 400

    file = request.files["resume"]
    if file.filename == "":
        return jsonify({"success": False, "message": "No file selected."}), 400
    if not allowed_file(file.filename):
        return jsonify({"success": False, "message": "Only PDF files are allowed."}), 400

    # Delete old resume if exists
    existing = col_students.find_one({"rollNo": roll_no})
    if existing and existing.get("resumeFile"):
        old_path = os.path.join(UPLOAD_FOLDER, existing["resumeFile"])
        if os.path.exists(old_path):
            os.remove(old_path)

    filename  = f"{roll_no}_{uuid.uuid4().hex[:8]}.pdf"
    file.save(os.path.join(UPLOAD_FOLDER, filename))

    col_students.update_one(
        {"rollNo": roll_no},
        {"$set": {"resumeFile": filename}},
        upsert=True
    )
    return jsonify({"success": True, "message": "Resume uploaded successfully.",
                    "resumeFile": filename})


@app.route("/api/student/status", methods=["GET"])
@role_required("student")
def student_get_status():
    """Student views their placement status and history."""
    roll_no = _get_student_roll()
    doc = col_students.find_one({"rollNo": roll_no})
    if not doc:
        return jsonify({"success": False, "message": "Profile not found."}), 404

    # Get action history for this student
    actions = list(col_actions.find(
        {"rollNo": roll_no},
        {"_id": 0}
    ).sort("timestamp", ASCENDING))

    return jsonify({
        "success": True,
        "student": serialize(doc),
        "history": actions
    })


def _get_student_roll():
    roll = session.get("roll_no", "")
    if not roll:
        user = col_users.find_one({"username": session.get("user"), "role": "student"})
        if user:
            roll = user.get("rollNo", "")
            session["roll_no"] = roll
    return roll


@app.route("/api/student/change-password", methods=["POST"])
@role_required("student")
def student_change_password():
    data     = request.get_json(silent=True) or {}
    old_pass = (data.get("old_password") or "").strip()
    new_pass = (data.get("new_password") or "").strip()
    if not old_pass or not new_pass:
        return jsonify({"success": False, "message": "Both fields required."}), 400
    if len(new_pass) < 4:
        return jsonify({"success": False, "message": "Min 4 characters."}), 400
    user = col_users.find_one({"username": session["user"]})
    if not user or user["password"] != old_pass:
        return jsonify({"success": False, "message": "Current password incorrect."}), 401
    col_users.update_one({"username": session["user"]}, {"$set": {"password": new_pass}})
    return jsonify({"success": True, "message": "Password changed."})


# ════════════════════════════════════════════════════════════════
#  ADMIN API
# ════════════════════════════════════════════════════════════════

@app.route("/api/admin/stats", methods=["GET"])
@role_required("admin")
def admin_stats():
    total     = col_students.count_documents({})
    placed    = col_students.count_documents({"placementStatus": "Placed"})
    shortlist = col_students.count_documents({"placementStatus": "Shortlisted"})
    interview = col_students.count_documents({"placementStatus": "Interview Scheduled"})
    registered = col_students.count_documents({"placementStatus": "Registered"})

    cgpa_pipe = [{"$group": {"_id": None, "avg": {"$avg": "$cgpa"}}}]
    cgpa_res  = list(col_students.aggregate(cgpa_pipe))
    avg_cgpa  = round(cgpa_res[0]["avg"] or 0, 2) if cgpa_res else 0

    pkg_pipe = [
        {"$match": {"placementStatus": "Placed", "packageLPA": {"$gt": 0}}},
        {"$group": {"_id": None, "avg": {"$avg": "$packageLPA"}, "max": {"$max": "$packageLPA"}}}
    ]
    pkg_res  = list(col_students.aggregate(pkg_pipe))
    avg_pkg  = round(pkg_res[0]["avg"] or 0, 2) if pkg_res else 0
    max_pkg  = round(pkg_res[0]["max"] or 0, 2) if pkg_res else 0

    dept_pipe = [
        {"$group": {
            "_id":    "$department",
            "total":  {"$sum": 1},
            "placed": {"$sum": {"$cond": [{"$eq": ["$placementStatus", "Placed"]}, 1, 0]}}
        }},
        {"$sort": {"total": DESCENDING}}
    ]
    dept_stats = list(col_students.aggregate(dept_pipe))

    status_pipe = [{"$group": {"_id": "$placementStatus", "count": {"$sum": 1}}}]
    status_stats = list(col_students.aggregate(status_pipe))

    top_placed = list(col_students.find(
        {"placementStatus": "Placed"},
        {"_id": 0, "name": 1, "rollNo": 1, "department": 1, "placedCompany": 1, "packageLPA": 1}
    ).sort("packageLPA", DESCENDING).limit(5))

    total_companies = col_companies.count_documents({})

    return jsonify({
        "total": total, "placed": placed, "shortlisted": shortlist,
        "interview": interview, "registered": registered,
        "avg_cgpa": avg_cgpa, "avg_package": avg_pkg, "max_package": max_pkg,
        "placement_rate": round(placed / total * 100, 1) if total else 0,
        "total_companies": total_companies,
        "dept_stats":   [{"dept": d["_id"] or "N/A", "total": d["total"], "placed": d["placed"]} for d in dept_stats],
        "status_stats": [{"status": s["_id"] or "N/A", "count": s["count"]} for s in status_stats],
        "top_placed":   top_placed,
    })


@app.route("/api/admin/students", methods=["GET"])
@role_required("admin")
def admin_get_students():
    page     = max(1, int(request.args.get("page", 1)))
    per_page = min(100, max(1, int(request.args.get("per_page", 10))))
    search   = (request.args.get("search") or "").strip()
    status   = (request.args.get("status") or "").strip()
    sort_by  = request.args.get("sort", "name")
    order    = DESCENDING if request.args.get("order", "asc") == "desc" else ASCENDING

    allowed_sort = {"name", "rollNo", "department", "cgpa", "placementStatus", "packageLPA"}
    if sort_by not in allowed_sort: sort_by = "name"

    query = {}
    if search:
        regex = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"name": regex}, {"rollNo": regex},
                        {"department": regex}, {"placedCompany": regex}]
    if status: query["placementStatus"] = status

    total  = col_students.count_documents(query)
    skip   = (page - 1) * per_page
    cursor = col_students.find(query).sort(sort_by, order).skip(skip).limit(per_page)
    docs   = [serialize(s) for s in cursor]

    return jsonify({
        "students": docs, "total": total, "page": page,
        "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if total else 1,
    })


@app.route("/api/admin/students/<string:roll_no>", methods=["DELETE"])
@role_required("admin")
def admin_delete_student(roll_no):
    doc = col_students.find_one({"rollNo": roll_no.upper()})
    if not doc:
        return jsonify({"success": False, "message": "Student not found."}), 404
    # Delete resume file
    if doc.get("resumeFile"):
        path = os.path.join(UPLOAD_FOLDER, doc["resumeFile"])
        if os.path.exists(path): os.remove(path)
    col_students.delete_one({"rollNo": roll_no.upper()})
    col_users.delete_one({"rollNo": roll_no.upper(), "role": "student"})
    col_actions.delete_many({"rollNo": roll_no.upper()})
    return jsonify({"success": True, "message": "Student deleted."})


# Admin: manage companies
@app.route("/api/admin/companies", methods=["GET"])
@role_required("admin")
def admin_get_companies():
    docs = list(col_companies.find().sort("name", ASCENDING))
    return jsonify({"success": True, "companies": [serialize(c) for c in docs]})


@app.route("/api/admin/companies", methods=["POST"])
@role_required("admin")
def admin_add_company():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "message": "Company name is required."}), 400

    if col_companies.find_one({"name": name}):
        return jsonify({"success": False, "message": f"'{name}' already exists."}), 409

    company = {
        "name":             name,
        "industry":         (data.get("industry") or "").strip(),
        "visitDate":        (data.get("visitDate") or "").strip(),
        "ctcLPA":           round(float(data.get("ctcLPA") or 0), 2),
        "eligibilityCGPA":  round(float(data.get("eligibilityCGPA") or 0), 2),
        "openRoles":        (data.get("openRoles") or "").strip(),
        "description":      (data.get("description") or "").strip(),
        "driveStatus":      data.get("driveStatus", "Upcoming"),
    }
    result = col_companies.insert_one(company)
    company["_id"] = str(result.inserted_id)

    # Create company login
    username = name.lower().replace(" ", "_")
    base_username = username
    counter = 1
    while col_users.find_one({"username": username}):
        username = f"{base_username}_{counter}"
        counter += 1

    col_users.insert_one({
        "username":  username,
        "password":  username,   # default password = username
        "role":      "company",
        "name":      name,
        "companyId": result.inserted_id,
    })

    return jsonify({
        "success": True,
        "message": f"Company added. Login: {username} / {username}",
        "company": company,
        "login":   {"username": username, "password": username}
    }), 201


@app.route("/api/admin/companies/<string:company_id>", methods=["PUT"])
@role_required("admin")
def admin_update_company(company_id):
    data = request.get_json(silent=True) or {}
    data.pop("_id", None)
    update = {
        "industry":        (data.get("industry") or "").strip(),
        "visitDate":       (data.get("visitDate") or "").strip(),
        "ctcLPA":          round(float(data.get("ctcLPA") or 0), 2),
        "eligibilityCGPA": round(float(data.get("eligibilityCGPA") or 0), 2),
        "openRoles":       (data.get("openRoles") or "").strip(),
        "description":     (data.get("description") or "").strip(),
        "driveStatus":     data.get("driveStatus", "Upcoming"),
    }
    col_companies.update_one({"_id": ObjectId(company_id)}, {"$set": update})
    updated = col_companies.find_one({"_id": ObjectId(company_id)})
    return jsonify({"success": True, "company": serialize(updated)})


@app.route("/api/admin/companies/<string:company_id>", methods=["DELETE"])
@role_required("admin")
def admin_delete_company(company_id):
    company = col_companies.find_one({"_id": ObjectId(company_id)})
    if not company:
        return jsonify({"success": False, "message": "Company not found."}), 404
    col_companies.delete_one({"_id": ObjectId(company_id)})
    col_users.delete_one({"companyId": ObjectId(company_id), "role": "company"})
    return jsonify({"success": True, "message": "Company deleted."})


# Admin: create student login account
@app.route("/api/admin/create-student", methods=["POST"])
@role_required("admin")
def admin_create_student():
    """Admin creates a login account for a student (before student fills profile)."""
    data     = request.get_json(silent=True) or {}
    roll_no  = (data.get("rollNo") or "").strip().upper()
    name     = (data.get("name") or "").strip()

    if not roll_no or not name:
        return jsonify({"success": False, "message": "Roll number and name are required."}), 400

    username = roll_no.lower()
    if col_users.find_one({"username": username}):
        return jsonify({"success": False, "message": f"Account for {roll_no} already exists."}), 409

    col_users.insert_one({
        "username": username,
        "password": username,
        "role":     "student",
        "name":     name,
        "rollNo":   roll_no,
    })
    return jsonify({
        "success": True,
        "message": f"Student account created. Login: {username} / {username}",
        "login":   {"username": username, "password": username}
    }), 201


# ════════════════════════════════════════════════════════════════
#  COMPANY API
# ════════════════════════════════════════════════════════════════

def _get_company_id():
    cid = session.get("company_id", "")
    if not cid:
        user = col_users.find_one({"username": session.get("user"), "role": "company"})
        if user:
            cid = str(user.get("companyId", ""))
            session["company_id"] = cid
    return cid


@app.route("/api/company/info", methods=["GET"])
@role_required("company")
def company_info():
    cid = _get_company_id()
    if not cid:
        return jsonify({"success": False, "message": "Company not found."}), 404
    company = col_companies.find_one({"_id": ObjectId(cid)})
    if not company:
        return jsonify({"success": False, "message": "Company record not found."}), 404
    return jsonify({"success": True, "company": serialize(company)})


@app.route("/api/company/eligible-students", methods=["GET"])
@role_required("company")
def company_eligible_students():
    """Return students eligible for this company (CGPA >= company eligibility)."""
    cid = _get_company_id()
    company = col_companies.find_one({"_id": ObjectId(cid)})
    if not company:
        return jsonify({"success": False, "message": "Company not found."}), 404

    min_cgpa = float(company.get("eligibilityCGPA") or 0)
    search   = (request.args.get("search") or "").strip()

    query = {
        "cgpa": {"$gte": min_cgpa},
        "placementStatus": {"$nin": ["Placed"]}  # exclude already placed
    }
    if search:
        regex = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"name": regex}, {"rollNo": regex}, {"department": regex}]

    docs = list(col_students.find(query).sort("cgpa", DESCENDING))

    # Mark which students this company has already actioned
    actioned = {
        a["rollNo"]: a["action"]
        for a in col_actions.find({"companyId": cid})
    }

    result = []
    for s in docs:
        s = serialize(s)
        s["companyAction"] = actioned.get(s["rollNo"], None)
        result.append(s)

    return jsonify({"success": True, "students": result, "company": serialize(company)})


@app.route("/api/company/shortlist", methods=["POST"])
@role_required("company")
def company_shortlist():
    data    = request.get_json(silent=True) or {}
    roll_no = (data.get("rollNo") or "").strip().upper()
    cid     = _get_company_id()

    student = col_students.find_one({"rollNo": roll_no})
    if not student:
        return jsonify({"success": False, "message": "Student not found."}), 404

    company = col_companies.find_one({"_id": ObjectId(cid)})

    col_students.update_one({"rollNo": roll_no},
                             {"$set": {"placementStatus": "Shortlisted"}})

    _log_action(roll_no, cid, company["name"], "Shortlisted",
                f"Shortlisted by {company['name']}")

    return jsonify({"success": True, "message": f"{student['name']} shortlisted."})


@app.route("/api/company/schedule-interview", methods=["POST"])
@role_required("company")
def company_schedule_interview():
    data          = request.get_json(silent=True) or {}
    roll_no       = (data.get("rollNo") or "").strip().upper()
    interview_date = (data.get("interviewDate") or "").strip()
    interview_time = (data.get("interviewTime") or "").strip()
    venue          = (data.get("venue") or "").strip()
    cid            = _get_company_id()

    if not roll_no or not interview_date:
        return jsonify({"success": False, "message": "Roll number and interview date required."}), 400

    student = col_students.find_one({"rollNo": roll_no})
    if not student:
        return jsonify({"success": False, "message": "Student not found."}), 404

    company = col_companies.find_one({"_id": ObjectId(cid)})

    col_students.update_one({"rollNo": roll_no}, {"$set": {
        "placementStatus":  "Interview Scheduled",
        "interviewDate":    interview_date,
        "interviewTime":    interview_time,
        "interviewVenue":   venue,
        "interviewCompany": company["name"],
    }})

    _log_action(roll_no, cid, company["name"], "Interview Scheduled",
                f"Interview on {interview_date} {interview_time} at {venue or 'TBD'}")

    return jsonify({"success": True, "message": "Interview scheduled."})


@app.route("/api/company/mark-placed", methods=["POST"])
@role_required("company")
def company_mark_placed():
    data       = request.get_json(silent=True) or {}
    roll_no    = (data.get("rollNo") or "").strip().upper()
    package    = data.get("packageLPA", 0)
    offer_role = (data.get("role") or "").strip()
    cid        = _get_company_id()

    student = col_students.find_one({"rollNo": roll_no})
    if not student:
        return jsonify({"success": False, "message": "Student not found."}), 404

    company = col_companies.find_one({"_id": ObjectId(cid)})

    try: package = round(float(package), 2)
    except: package = 0

    col_students.update_one({"rollNo": roll_no}, {"$set": {
        "placementStatus": "Placed",
        "placedCompany":   company["name"],
        "packageLPA":      package,
        "placedRole":      offer_role,
    }})

    _log_action(roll_no, cid, company["name"], "Placed",
                f"Placed at {company['name']} as {offer_role or 'N/A'} — ₹{package} LPA")

    return jsonify({"success": True, "message": f"{student['name']} marked as placed."})


@app.route("/api/company/reject", methods=["POST"])
@role_required("company")
def company_reject():
    data    = request.get_json(silent=True) or {}
    roll_no = (data.get("rollNo") or "").strip().upper()
    reason  = (data.get("reason") or "").strip()
    cid     = _get_company_id()

    student = col_students.find_one({"rollNo": roll_no})
    if not student:
        return jsonify({"success": False, "message": "Student not found."}), 404

    company = col_companies.find_one({"_id": ObjectId(cid)})

    col_students.update_one({"rollNo": roll_no},
                             {"$set": {"placementStatus": "Rejected"}})

    _log_action(roll_no, cid, company["name"], "Rejected",
                f"Rejected by {company['name']}" + (f": {reason}" if reason else ""))

    return jsonify({"success": True, "message": f"{student['name']} marked as rejected."})


@app.route("/api/company/actioned-students", methods=["GET"])
@role_required("company")
def company_actioned_students():
    """Students this company has taken action on."""
    cid     = _get_company_id()
    actions = list(col_actions.find({"companyId": cid}))
    result  = []
    for a in actions:
        s = col_students.find_one({"rollNo": a["rollNo"]},
                                   {"_id": 0, "name": 1, "rollNo": 1,
                                    "department": 1, "cgpa": 1,
                                    "placementStatus": 1, "packageLPA": 1})
        if s:
            s["action"]    = a["action"]
            s["note"]      = a.get("note", "")
            s["timestamp"] = a.get("timestamp", "")
            result.append(s)
    return jsonify({"success": True, "students": result})


def _log_action(roll_no, company_id, company_name, action, note=""):
    from datetime import datetime
    # Update or insert action record
    col_actions.update_one(
        {"rollNo": roll_no, "companyId": company_id},
        {"$set": {
            "rollNo":      roll_no,
            "companyId":   company_id,
            "companyName": company_name,
            "action":      action,
            "note":        note,
            "timestamp":   datetime.now().strftime("%Y-%m-%d %H:%M"),
        }},
        upsert=True
    )


# ── Public company list (for students) ───────────────────────────
@app.route("/api/companies/public", methods=["GET"])
@login_required
def public_companies():
    docs = list(col_companies.find({}, {"_id": 1, "name": 1, "industry": 1,
                                        "ctcLPA": 1, "visitDate": 1,
                                        "eligibilityCGPA": 1, "openRoles": 1,
                                        "driveStatus": 1, "description": 1}))
    return jsonify({"success": True, "companies": [serialize(c) for c in docs]})


# ── Error handlers ────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"success": False, "message": "Not found."}), 404
    return redirect(url_for("login_page"))

@app.errorhandler(413)
def too_large(e):
    return jsonify({"success": False, "message": f"File too large. Max {MAX_FILE_MB}MB."}), 413

@app.errorhandler(500)
def server_error(e):
    return jsonify({"success": False, "message": "Server error."}), 500

#last weebhook
if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=False)
