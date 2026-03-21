'use strict';
let interviewModal,placedModal,rejectModal;
let allEligible=[];

document.addEventListener('DOMContentLoaded',()=>{
  interviewModal = new bootstrap.Modal(document.getElementById('interviewModal'));
  placedModal    = new bootstrap.Modal(document.getElementById('placedModal'));
  rejectModal    = new bootstrap.Modal(document.getElementById('rejectModal'));
  setupSidebar();
  setupModals();
  loadCompanyInfo();
  loadEligibleStudents();

  document.getElementById('searchEligible').addEventListener('input', e=>{
    filterCards(e.target.value.trim().toLowerCase());
  });
});

function showTab(name,el){
  ['Eligible','Actioned'].forEach(t=>document.getElementById('tab'+t).classList.add('d-none'));
  document.getElementById('tab'+cap(name)).classList.remove('d-none');
  document.getElementById('breadcrumbCurrent').textContent={eligible:'Eligible Students',actioned:'My Actions'}[name]||name;
  document.querySelectorAll('.sidebar-link[data-section]').forEach(a=>a.classList.toggle('active',a.dataset.section===name));
  if(name==='actioned') loadActionedStudents();
  closeMobile();
}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}

function setupSidebar(){
  const sb=document.getElementById('sidebar'),tog=document.getElementById('sidebarToggle');
  const ov=document.createElement('div');ov.className='sidebar-overlay';document.body.appendChild(ov);
  tog.addEventListener('click',()=>{sb.classList.toggle('open');ov.classList.toggle('show');});
  ov.addEventListener('click',closeMobile);
}
function closeMobile(){if(window.innerWidth<992){document.getElementById('sidebar').classList.remove('open');document.querySelector('.sidebar-overlay').classList.remove('show');}}

async function loadCompanyInfo(){
  try{
    const res=await api('/api/company/info');const data=await res.json();
    if(!data.success)return;
    const c=data.company;
    document.getElementById('companyDisplayName').textContent=c.name;
    document.getElementById('infoCTC').textContent=c.ctcLPA||'—';
    document.getElementById('infoEligibility').textContent=c.eligibilityCGPA||'—';
    document.getElementById('infoVisitDate').textContent=c.visitDate||'TBD';
    document.getElementById('infoRoles').textContent=c.openRoles||'—';
    const ds=document.getElementById('infoDriveStatus');
    const m={Upcoming:'bg-info text-dark',Ongoing:'bg-warning text-dark',Completed:'bg-success'};
    ds.innerHTML=`<span class="badge ${m[c.driveStatus]||'bg-secondary'}">${esc(c.driveStatus||'')}</span>`;
  }catch(e){console.error(e);}
}

async function loadEligibleStudents(){
  const container=document.getElementById('eligibleStudentCards');
  container.innerHTML=`<div class="col-12 text-center py-4"><span class="spinner-border me-2"></span>Loading eligible students…</div>`;
  try{
    const res=await api('/api/company/eligible-students');const data=await res.json();
    if(!data.success){container.innerHTML=`<div class="col-12 text-center text-danger py-4">${esc(data.message)}</div>`;return;}
    allEligible=data.students;
    renderEligibleCards(allEligible);
  }catch(e){container.innerHTML=`<div class="col-12 text-center text-danger py-4">Failed to load.</div>`;}
}

function filterCards(query){
  if(!query){renderEligibleCards(allEligible);return;}
  renderEligibleCards(allEligible.filter(s=>
    (s.name||'').toLowerCase().includes(query)||
    (s.rollNo||'').toLowerCase().includes(query)||
    (s.department||'').toLowerCase().includes(query)
  ));
}

function renderEligibleCards(list){
  const container=document.getElementById('eligibleStudentCards');
  if(!list.length){
    container.innerHTML=`<div class="col-12"><div class="empty-state"><i class="bi bi-person-x"></i><p>No eligible students found.</p></div></div>`;return;
  }
  container.innerHTML=list.map(s=>`
    <div class="col-md-6 col-xl-4">
      <div class="company-card student-eligible-card">
        <div class="d-flex align-items-start gap-3 mb-2">
          <div class="student-mini-avatar"><i class="bi bi-person-fill"></i></div>
          <div class="flex-grow-1">
            <div class="fw-bold">${esc(s.name)}</div>
            <div class="text-muted small"><code>${esc(s.rollNo)}</code> &bull; ${esc(s.department)}</div>
          </div>
          ${statusBadge(s.placementStatus)}
        </div>

        <div class="d-flex gap-3 mb-2" style="font-size:0.83rem;">
          <span><i class="bi bi-mortarboard me-1 text-primary"></i><strong>${s.cgpa}</strong> CGPA</span>
          ${s.email?`<span><i class="bi bi-envelope me-1 text-muted"></i>${esc(s.email)}</span>`:''}
        </div>

        ${s.skills?`<div class="skills-box mb-2">${s.skills.split(',').map(sk=>`<span class="skill-pill">${esc(sk.trim())}</span>`).join('')}</div>`:''}

        <div class="d-flex gap-2 flex-wrap mb-2">
          ${s.resumeFile
            ?`<a href="/resume/${esc(s.resumeFile)}" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="bi bi-file-pdf me-1"></i>Resume</a>`
            :`<span class="text-muted small"><i class="bi bi-exclamation-circle me-1"></i>No resume</span>`}
          ${s.linkedin?`<a href="${esc(s.linkedin)}" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="bi bi-linkedin me-1"></i>LinkedIn</a>`:''}
        </div>

        <div class="d-flex gap-2 flex-wrap mt-auto pt-2 border-top">
          ${actionButtons(s)}
        </div>
      </div>
    </div>`).join('');
}

function actionButtons(s){
  const action = s.companyAction;
  if(s.placementStatus==='Placed')
    return `<span class="badge bg-success py-2 px-3"><i class="bi bi-patch-check me-1"></i>Placed</span>`;
  if(s.placementStatus==='Rejected')
    return `<span class="badge bg-danger py-2 px-3"><i class="bi bi-x-circle me-1"></i>Rejected</span>`;

  let btns='';
  if(!action||action==='Shortlisted'||action==='Interview Scheduled'){
    if(!action)
      btns+=`<button class="btn btn-sm btn-warning" onclick="shortlist('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-bookmark-fill me-1"></i>Shortlist</button>`;
    if(action==='Shortlisted'||action==='Interview Scheduled')
      btns+=`<button class="btn btn-sm btn-primary" onclick="openScheduleInterview('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-calendar-event me-1"></i>Schedule Interview</button>`;
    if(action==='Interview Scheduled')
      btns+=`<button class="btn btn-sm btn-success" onclick="openMarkPlaced('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-patch-check me-1"></i>Mark Placed</button>`;
    btns+=`<button class="btn btn-sm btn-outline-danger" onclick="openReject('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-x-circle me-1"></i>Reject</button>`;
  }
  return btns||`<span class="text-muted small">No actions available</span>`;
}

function statusBadge(s){
  const m={'Placed':'bg-success','Registered':'bg-secondary','Shortlisted':'bg-warning text-dark','Interview Scheduled':'bg-info text-dark','Rejected':'bg-danger'};
  return `<span class="badge ${m[s]||'bg-secondary'} ms-auto">${esc(s||'—')}</span>`;
}

// ── Shortlist ──────────────────────────────────────────────────
async function shortlist(rollNo, name){
  try{
    const res=await api('/api/company/shortlist',{method:'POST',body:JSON.stringify({rollNo})});
    const data=await res.json();
    if(data.success){showToast(`${name} shortlisted!`,'success');loadEligibleStudents();}
    else showToast(data.message,'error');
  }catch{showToast('Network error.','error');}
}

// ── Schedule Interview ─────────────────────────────────────────
function openScheduleInterview(rollNo, name){
  document.getElementById('intRollNo').value=rollNo;
  document.getElementById('intStudentName').textContent=name;
  document.getElementById('intDate').value='';
  document.getElementById('intTime').value='';
  document.getElementById('intVenue').value='';
  hideAlert('intAlert');
  interviewModal.show();
}

function setupModals(){
  document.getElementById('saveIntBtn').addEventListener('click', async()=>{
    const rollNo=document.getElementById('intRollNo').value;
    const date=document.getElementById('intDate').value;
    const time=document.getElementById('intTime').value;
    const venue=document.getElementById('intVenue').value.trim();
    const btn=document.getElementById('saveIntBtn'),txt=document.getElementById('saveIntText'),spin=document.getElementById('saveIntSpinner');
    hideAlert('intAlert');
    if(!date){showAlert('intAlert','Interview date is required.','danger');return;}
    btn.disabled=true;spin.classList.remove('d-none');txt.textContent='Scheduling…';
    try{
      const res=await api('/api/company/schedule-interview',{method:'POST',body:JSON.stringify({rollNo,interviewDate:date,interviewTime:time,venue})});
      const data=await res.json();
      if(data.success){interviewModal.hide();showToast('Interview scheduled!','success');loadEligibleStudents();}
      else showAlert('intAlert',data.message,'danger');
    }catch{showAlert('intAlert','Network error.','danger');}
    finally{btn.disabled=false;spin.classList.add('d-none');txt.textContent='Schedule';}
  });

  document.getElementById('savePlacedBtn').addEventListener('click', async()=>{
    const rollNo=document.getElementById('placedRollNo').value;
    const pkg=document.getElementById('placedPackage').value;
    const role=document.getElementById('placedRole').value.trim();
    const btn=document.getElementById('savePlacedBtn'),txt=document.getElementById('savePlacedText'),spin=document.getElementById('savePlacedSpinner');
    hideAlert('placedAlert');
    if(!pkg){showAlert('placedAlert','Package is required.','danger');return;}
    btn.disabled=true;spin.classList.remove('d-none');txt.textContent='Confirming…';
    try{
      const res=await api('/api/company/mark-placed',{method:'POST',body:JSON.stringify({rollNo,packageLPA:pkg,role})});
      const data=await res.json();
      if(data.success){placedModal.hide();showToast('Student placed! 🎉','success');loadEligibleStudents();}
      else showAlert('placedAlert',data.message,'danger');
    }catch{showAlert('placedAlert','Network error.','danger');}
    finally{btn.disabled=false;spin.classList.add('d-none');txt.textContent='Confirm Placement';}
  });

  document.getElementById('confirmRejectBtn').addEventListener('click', async()=>{
    const rollNo=document.getElementById('rejectRollNo').value;
    const reason=document.getElementById('rejectReason').value.trim();
    const btn=document.getElementById('confirmRejectBtn'),txt=document.getElementById('rejectBtnText'),spin=document.getElementById('rejectSpinner');
    btn.disabled=true;spin.classList.remove('d-none');txt.textContent='Rejecting…';
    try{
      const res=await api('/api/company/reject',{method:'POST',body:JSON.stringify({rollNo,reason})});
      const data=await res.json();
      if(data.success){rejectModal.hide();showToast('Student rejected.','info');loadEligibleStudents();}
      else showToast(data.message,'error');
    }catch{showToast('Network error.','error');}
    finally{btn.disabled=false;spin.classList.add('d-none');txt.textContent='Reject';rejectModal.hide();}
  });
}

function openMarkPlaced(rollNo,name){
  document.getElementById('placedRollNo').value=rollNo;
  document.getElementById('placedStudentName').textContent=name;
  document.getElementById('placedPackage').value='';
  document.getElementById('placedRole').value='';
  hideAlert('placedAlert');
  placedModal.show();
}

function openReject(rollNo,name){
  document.getElementById('rejectRollNo').value=rollNo;
  document.getElementById('rejectStudentName').textContent=name;
  document.getElementById('rejectReason').value='';
  rejectModal.show();
}

// ── Actioned students ──────────────────────────────────────────
async function loadActionedStudents(){
  const tbody=document.getElementById('actionedBody');
  tbody.innerHTML=`<tr><td colspan="7" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr>`;
  try{
    const res=await api('/api/company/actioned-students');const data=await res.json();
    if(!data.students.length){tbody.innerHTML=`<tr><td colspan="7" class="text-center text-muted py-4">No actions taken yet.</td></tr>`;return;}
    tbody.innerHTML=data.students.map(s=>`
      <tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td><code>${esc(s.rollNo)}</code></td>
        <td>${esc(s.department||'—')}</td>
        <td>${s.cgpa}</td>
        <td>${statusBadge(s.action)}</td>
        <td class="text-muted small">${esc(s.note||'—')}</td>
        <td>
          ${s.action==='Shortlisted'?`<button class="btn btn-sm btn-primary" onclick="openScheduleInterview('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-calendar-event"></i></button>`:''}
          ${s.action==='Interview Scheduled'?`<button class="btn btn-sm btn-success" onclick="openMarkPlaced('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-patch-check"></i></button>`:''}
        </td>
      </tr>`).join('');
  }catch{tbody.innerHTML=`<tr><td colspan="7" class="text-center text-danger">Failed to load.</td></tr>`;}
}

// ── Helpers ──────────────────────────────────────────────────
async function api(url,opts={}){
  const res=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
  if(res.status===401){window.location.href='/loginPage';throw new Error('Unauth');}
  return res;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showAlert(id,msg,type){const el=document.getElementById(id);el.className='alert alert-'+type;el.textContent=msg;el.classList.remove('d-none');}
function hideAlert(id){document.getElementById(id).classList.add('d-none');}
function showToast(msg,type='info'){
  const c=document.getElementById('toastContainer');const el=document.createElement('div');
  el.className=`toast sms-toast toast-${type}`;el.setAttribute('role','alert');
  el.innerHTML=`<div class="toast-header"><strong class="me-auto">${{success:'Success',error:'Error',info:'Info'}[type]||'Info'}</strong><button type="button" class="btn-close btn-close-sm" data-bs-dismiss="toast"></button></div><div class="toast-body">${esc(msg)}</div>`;
  c.appendChild(el);new bootstrap.Toast(el,{delay:3500}).show();el.addEventListener('hidden.bs.toast',()=>el.remove());
}
