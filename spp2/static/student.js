'use strict';
let studentProfile = null;

document.addEventListener('DOMContentLoaded', () => {
  setupSidebar();
  setupResumeUpload();
  loadProfile();
  loadCompanies();
  document.getElementById('profileForm').addEventListener('submit', async e => { e.preventDefault(); await saveProfile(); });
});

function showTab(name, el) {
  ['Profile','Resume','Status','Companies','Password'].forEach(t =>
    document.getElementById('tab'+t).classList.add('d-none'));
  document.getElementById('tab'+cap(name)).classList.remove('d-none');
  document.getElementById('breadcrumbCurrent').textContent =
    {profile:'My Profile',resume:'Resume',status:'Placement Status',companies:'Companies',password:'Change Password'}[name]||name;
  document.querySelectorAll('.sidebar-link[data-section]').forEach(a =>
    a.classList.toggle('active', a.dataset.section===name));
  if (name==='status') loadStatus();
  closeMobile();
}
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

function setupSidebar() {
  const sb=document.getElementById('sidebar'), tog=document.getElementById('sidebarToggle');
  const ov=document.createElement('div'); ov.className='sidebar-overlay'; document.body.appendChild(ov);
  tog.addEventListener('click',()=>{ sb.classList.toggle('open'); ov.classList.toggle('show'); });
  ov.addEventListener('click', closeMobile);
}
function closeMobile() {
  if(window.innerWidth<992){ document.getElementById('sidebar').classList.remove('open'); document.querySelector('.sidebar-overlay').classList.remove('show'); }
}

async function loadProfile() {
  try {
    const res=await api('/api/student/profile'); const data=await res.json();
    if (!data.success) return;
    if (data.student) {
      studentProfile = data.student;
      fillProfileForm(data.student);
      if (data.student.resumeFile) showCurrentResume(data.student.resumeFile);
    }
  } catch(e){ console.error(e); }
}

function fillProfileForm(s) {
  document.getElementById('pName').value     = s.name||'';
  document.getElementById('pRollNo').value   = s.rollNo||'';
  document.getElementById('pDept').value     = s.department||'';
  document.getElementById('pCGPA').value     = s.cgpa||'';
  document.getElementById('pEmail').value    = s.email||'';
  document.getElementById('pPhone').value    = s.phone||'';
  document.getElementById('pSkills').value   = s.skills||'';
  document.getElementById('pLinkedin').value = s.linkedin||'';
  document.getElementById('topbarName').textContent = s.name||'';
}

// Prefill roll no from session username
fetch('/api/student/profile',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{
  if(!d.student){
    // Get roll from username (which equals roll)
    const u = document.cookie; // won't work directly — just leave blank
  }
});

async function saveProfile() {
  const btn=document.getElementById('profileForm').querySelector('[type=submit]');
  const txt=document.getElementById('saveProfText'); const spin=document.getElementById('saveProfSpinner');
  hideAlert('profileAlert');

  const payload = {
    name:       document.getElementById('pName').value.trim(),
    department: document.getElementById('pDept').value,
    cgpa:       document.getElementById('pCGPA').value,
    email:      document.getElementById('pEmail').value.trim(),
    phone:      document.getElementById('pPhone').value.trim(),
    skills:     document.getElementById('pSkills').value.trim(),
    linkedin:   document.getElementById('pLinkedin').value.trim(),
  };

  btn.disabled=true; spin.classList.remove('d-none'); txt.textContent='Saving…';
  try {
    const res=await api('/api/student/profile',{method:'POST',body:JSON.stringify(payload)});
    const data=await res.json();
    if(data.success){
      studentProfile=data.student;
      showAlert('profileAlert','Profile saved successfully!','success');
      document.getElementById('topbarName').textContent=payload.name;
      // Prefill roll
      if(data.student) document.getElementById('pRollNo').value=data.student.rollNo||'';
      showToast('Profile saved!','success');
    } else { showAlert('profileAlert',data.message||'Failed.','danger'); }
  } catch { showAlert('profileAlert','Network error.','danger'); }
  finally { btn.disabled=false; spin.classList.add('d-none'); txt.textContent='Save Profile'; }
}

// ── Resume Upload ──────────────────────────────────────────────
function setupResumeUpload() {
  const fileInput=document.getElementById('resumeFile');
  const zone=document.getElementById('resumeZone');
  const actions=document.getElementById('uploadActions');
  const nameSpan=document.getElementById('selectedFileName');

  fileInput.addEventListener('change', ()=>{
    if(fileInput.files[0]){
      nameSpan.textContent=fileInput.files[0].name;
      actions.classList.remove('d-none');
    }
  });

  zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()=>zone.classList.remove('dragover'));
  zone.addEventListener('drop', e=>{
    e.preventDefault(); zone.classList.remove('dragover');
    if(e.dataTransfer.files[0]){ fileInput.files=e.dataTransfer.files; nameSpan.textContent=e.dataTransfer.files[0].name; actions.classList.remove('d-none'); }
  });

  document.getElementById('uploadResumeBtn').addEventListener('click', uploadResume);
}

async function uploadResume() {
  const fileInput=document.getElementById('resumeFile');
  const btn=document.getElementById('uploadResumeBtn');
  const txt=document.getElementById('uploadBtnText'); const spin=document.getElementById('uploadSpinner');
  hideAlert('resumeAlert');

  if(!fileInput.files[0]){ showAlert('resumeAlert','Please select a PDF file.','danger'); return; }

  const formData=new FormData(); formData.append('resume', fileInput.files[0]);

  btn.disabled=true; spin.classList.remove('d-none'); txt.textContent='Uploading…';
  try {
    const res=await fetch('/api/student/resume',{method:'POST',credentials:'same-origin',body:formData});
    const data=await res.json();
    if(data.success){
      showCurrentResume(data.resumeFile);
      showAlert('resumeAlert','Resume uploaded successfully!','success');
      showToast('Resume uploaded!','success');
      document.getElementById('uploadActions').classList.add('d-none');
      fileInput.value='';
    } else { showAlert('resumeAlert',data.message||'Upload failed.','danger'); }
  } catch { showAlert('resumeAlert','Network error.','danger'); }
  finally { btn.disabled=false; spin.classList.add('d-none'); txt.textContent='Upload Resume'; }
}

function showCurrentResume(filename) {
  const box=document.getElementById('currentResume');
  const link=document.getElementById('resumeLink');
  box.classList.remove('d-none');
  link.href='/resume/'+filename;
  link.textContent='View / Download Resume';
}

// ── Status ─────────────────────────────────────────────────────
async function loadStatus() {
  document.getElementById('statusLoading').classList.remove('d-none');
  document.getElementById('statusContent').classList.add('d-none');
  try {
    const res=await api('/api/student/status'); const data=await res.json();
    if(!data.success){ showToast(data.message,'error'); return; }
    const s=data.student;
    document.getElementById('statusBadge').textContent   = s.placementStatus||'—';
    document.getElementById('statusCompany').textContent = s.placedCompany||s.interviewCompany||'—';
    document.getElementById('statusPackage').textContent = s.packageLPA>0?'₹'+s.packageLPA+' LPA':'—';

    if(s.placementStatus==='Interview Scheduled'){
      const ic=document.getElementById('interviewCard');
      ic.style.display='';
      document.getElementById('intDate').textContent  = s.interviewDate||'—';
      document.getElementById('intTime').textContent  = s.interviewTime||'—';
      document.getElementById('intVenue').textContent = s.interviewVenue||'—';
    }

    renderTimeline(s.placementStatus, data.history||[]);
    document.getElementById('statusLoading').classList.add('d-none');
    document.getElementById('statusContent').classList.remove('d-none');
  } catch { showToast('Failed to load status.','error'); }
}

function renderTimeline(currentStatus, history) {
  const steps=[
    {key:'Registered',          label:'Registered',           sub:'Your account has been created.'},
    {key:'Shortlisted',         label:'Shortlisted',          sub:'A company has shortlisted you.'},
    {key:'Interview Scheduled', label:'Interview Scheduled',  sub:'Interview date has been set.'},
    {key:'Placed',              label:'Placed',               sub:'Congratulations! You are placed.'},
  ];
  const order = steps.map(s=>s.key);
  const currentIdx = order.indexOf(currentStatus);
  const isRejected = currentStatus==='Rejected';

  let html = '';
  if(isRejected) html += `<div class="alert alert-danger mb-3"><i class="bi bi-x-circle-fill me-2"></i>Your application was rejected. Please contact the placement officer.</div>`;

  html += '<div class="timeline-wrap">';
  steps.forEach((s,i)=>{
    const histEntry = history.find(h=>h.action===s.key);
    const done    = i < currentIdx || currentStatus===s.key;
    const current = s.key===currentStatus && !isRejected;
    const dotCls  = done&&!current?'done':current?'current':'';
    const note    = histEntry?histEntry.note:(!done?'Pending':'');
    html += `<div class="timeline-step">
      <div class="timeline-dot ${dotCls}"></div>
      <div>
        <div class="timeline-step-title ${current?'text-primary':''}">${s.label}</div>
        <div class="timeline-step-sub">${esc(note||s.sub)}</div>
        ${histEntry?`<div class="text-muted" style="font-size:0.75rem;">${histEntry.timestamp}</div>`:''}
      </div>
    </div>`;
  });
  html += '</div>';
  document.getElementById('timelineContainer').innerHTML = html;
}

// ── Companies ──────────────────────────────────────────────────
async function loadCompanies() {
  try {
    const res=await api('/api/companies/public'); const data=await res.json();
    const container=document.getElementById('studentCompanyCards');
    if(!data.companies.length){
      container.innerHTML=`<div class="col-12"><div class="empty-state"><i class="bi bi-building-x"></i><p>No companies listed yet.</p></div></div>`; return;
    }
    container.innerHTML = data.companies.map(c=>`
      <div class="col-md-6 col-xl-4">
        <div class="company-card">
          <div class="company-card-header">
            <div><div class="company-name">${esc(c.name)}</div><div class="company-industry">${esc(c.industry||'—')}</div></div>
            <span class="badge ${driveBadge(c.driveStatus)}">${esc(c.driveStatus||'')}</span>
          </div>
          <div class="company-info-row">
            <span><i class="bi bi-currency-rupee"></i>₹${c.ctcLPA} LPA</span>
            <span><i class="bi bi-mortarboard"></i>CGPA ≥ ${c.eligibilityCGPA}</span>
            <span><i class="bi bi-calendar3"></i>${c.visitDate||'TBD'}</span>
          </div>
          ${c.openRoles?`<div class="company-roles"><i class="bi bi-briefcase me-1"></i>${esc(c.openRoles)}</div>`:''}
          ${c.description?`<div class="company-desc">${esc(c.description)}</div>`:''}
          <div class="mt-2">
            ${studentProfile&&parseFloat(c.eligibilityCGPA)<=parseFloat(studentProfile.cgpa||0)
              ?`<span class="badge bg-success"><i class="bi bi-check me-1"></i>You are eligible</span>`
              :`<span class="badge bg-secondary"><i class="bi bi-x me-1"></i>Not eligible</span>`}
          </div>
        </div>
      </div>`).join('');
  } catch(e){ console.error(e); }
}
function driveBadge(s){ return {Upcoming:'bg-info text-dark',Ongoing:'bg-warning text-dark',Completed:'bg-success'}[s]||'bg-secondary'; }

// ── Change Password ────────────────────────────────────────────
async function changePassword() {
  const o=document.getElementById('oldPass').value.trim();
  const n=document.getElementById('newPass').value.trim();
  const c=document.getElementById('confirmPass').value.trim();
  const txt=document.getElementById('pwBtnText'); const spin=document.getElementById('pwSpinner');
  hideAlert('pwAlert');
  if(!o||!n||!c){ showAlert('pwAlert','All fields required.','danger'); return; }
  if(n!==c){ showAlert('pwAlert','Passwords do not match.','danger'); return; }
  if(n.length<4){ showAlert('pwAlert','Min 4 characters.','danger'); return; }
  spin.classList.remove('d-none'); txt.textContent='Updating…';
  try {
    const res=await api('/api/student/change-password',{method:'POST',body:JSON.stringify({old_password:o,new_password:n})});
    const data=await res.json();
    if(data.success){ showAlert('pwAlert','Password changed!','success'); document.getElementById('oldPass').value=document.getElementById('newPass').value=document.getElementById('confirmPass').value=''; }
    else showAlert('pwAlert',data.message,'danger');
  } catch { showAlert('pwAlert','Network error.','danger'); }
  finally { spin.classList.add('d-none'); txt.textContent='Update Password'; }
}

// ── Helpers ────────────────────────────────────────────────────
async function api(url,opts={}){
  const res=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
  if(res.status===401){window.location.href='/loginPage';throw new Error('Unauth');}
  return res;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showAlert(id,msg,type){const el=document.getElementById(id);el.className='alert alert-'+type;el.textContent=msg;el.classList.remove('d-none');}
function hideAlert(id){document.getElementById(id).classList.add('d-none');}
function showToast(msg,type='info'){
  const c=document.getElementById('toastContainer');
  const el=document.createElement('div');el.className=`toast sms-toast toast-${type}`;el.setAttribute('role','alert');
  el.innerHTML=`<div class="toast-header"><strong class="me-auto">${{success:'Success',error:'Error',info:'Info'}[type]||'Info'}</strong><button type="button" class="btn-close btn-close-sm" data-bs-dismiss="toast"></button></div><div class="toast-body">${esc(msg)}</div>`;
  c.appendChild(el);new bootstrap.Toast(el,{delay:3500}).show();el.addEventListener('hidden.bs.toast',()=>el.remove());
}
