'use strict';
const state={section:'dashboard',list:{page:1,perPage:10,search:'',status:'',sortCol:'name',sortOrder:'asc',total:0,totalPages:1},pendingDelRoll:null,charts:{status:null,dept:null},editCompanyId:null};
let deleteStudentModal,companyModal;

document.addEventListener('DOMContentLoaded',()=>{
  deleteStudentModal=new bootstrap.Modal(document.getElementById('deleteStudentModal'));
  companyModal=new bootstrap.Modal(document.getElementById('companyModal'));
  setupSidebar(); setupListControls(); setupExport(); setupCompanyModal();
  document.getElementById('confirmDeleteStudentBtn').addEventListener('click', confirmDeleteStudent);
  loadDashboard();
});

function showSection(name,el){
  ['Dashboard','Students','Companies','Accounts'].forEach(s=>document.getElementById('section'+s).classList.add('d-none'));
  document.getElementById('section'+cap(name)).classList.remove('d-none');
  state.section=name;
  document.querySelectorAll('.sidebar-link[data-section]').forEach(a=>a.classList.toggle('active',a.dataset.section===name));
  document.getElementById('breadcrumbCurrent').textContent={dashboard:'Dashboard',students:'Students',companies:'Companies',accounts:'Create Accounts'}[name]||name;
  if(name==='dashboard') loadDashboard();
  if(name==='students')  loadStudents();
  if(name==='companies') loadCompanies();
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

// ── Dashboard ────────────────────────────────────────────────
async function loadDashboard(){
  try{
    const res=await api('/api/admin/stats');const d=await res.json();
    document.getElementById('statTotal').textContent     =d.total;
    document.getElementById('statPlaced').textContent    =d.placed;
    document.getElementById('statRate').textContent      =d.placement_rate+'%';
    document.getElementById('statPkg').textContent       =d.avg_package;
    document.getElementById('statCompanies').textContent =d.total_companies;
    document.getElementById('statMaxPkg').textContent    =d.max_package;
    document.getElementById('statCGPA').textContent      =d.avg_cgpa;
    document.getElementById('statInProcess').textContent =(d.shortlisted||0)+(d.interview||0);
    document.getElementById('studentBadge').textContent  =d.total;
    document.getElementById('companyBadge').textContent  =d.total_companies;
    renderTopPlaced(d.top_placed||[]);
    renderStatusChart(d.status_stats||[]);
    renderDeptChart(d.dept_stats||[]);
  }catch(e){console.error(e);}
}
function renderTopPlaced(list){
  document.getElementById('topPlacedBody').innerHTML=list.length
    ?list.map((s,i)=>`<tr><td class="${i===0?'rank-1':''}">${i+1}</td><td><strong>${esc(s.name)}</strong></td><td><code>${esc(s.rollNo)}</code></td><td>${esc(s.department)}</td><td>${esc(s.placedCompany||'—')}</td><td>₹${s.packageLPA} LPA</td></tr>`).join('')
    :`<tr><td colspan="6" class="text-center text-muted py-3">No placed students yet.</td></tr>`;
}
function renderStatusChart(stats){
  const ctx=document.getElementById('chartStatus').getContext('2d');
  if(state.charts.status) state.charts.status.destroy();
  const colors={'Placed':'#22c55e','Registered':'#9ca3af','Shortlisted':'#f59e0b','Interview Scheduled':'#0ea5e9','Rejected':'#ef4444','Profile Incomplete':'#e5e7eb'};
  state.charts.status=new Chart(ctx,{type:'doughnut',data:{labels:stats.map(s=>s.status),datasets:[{data:stats.map(s=>s.count),backgroundColor:stats.map(s=>colors[s.status]||'#6b7280'),borderWidth:0,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}}});
}
function renderDeptChart(depts){
  const ctx=document.getElementById('chartDept').getContext('2d');
  if(state.charts.dept) state.charts.dept.destroy();
  state.charts.dept=new Chart(ctx,{type:'bar',data:{labels:depts.map(d=>d.dept),datasets:[{label:'Total',data:depts.map(d=>d.total),backgroundColor:'#dbeafe',borderRadius:6},{label:'Placed',data:depts.map(d=>d.placed),backgroundColor:'#22c55e',borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:12}}},scales:{y:{beginAtZero:true,ticks:{stepSize:1},grid:{color:'#f3f4f8'}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
}

// ── Students ─────────────────────────────────────────────────
function setupListControls(){
  const si=document.getElementById('searchInput'),cs=document.getElementById('clearSearch');
  let timer;
  si.addEventListener('input',()=>{cs.classList.toggle('d-none',!si.value);clearTimeout(timer);timer=setTimeout(()=>{state.list.search=si.value.trim();state.list.page=1;loadStudents();},300);});
  cs.addEventListener('click',()=>{si.value='';cs.classList.add('d-none');state.list.search='';state.list.page=1;loadStudents();});
  document.getElementById('filterStatus').addEventListener('change',e=>{state.list.status=e.target.value;state.list.page=1;loadStudents();});
  document.getElementById('perPageSelect').addEventListener('change',e=>{state.list.perPage=parseInt(e.target.value);state.list.page=1;loadStudents();});
  document.querySelectorAll('.sortable').forEach(th=>th.addEventListener('click',()=>{
    const col=th.dataset.col;
    state.list.sortOrder=state.list.sortCol===col?(state.list.sortOrder==='asc'?'desc':'asc'):'asc';
    state.list.sortCol=col;loadStudents();
  }));
}
async function loadStudents(){
  const tbody=document.getElementById('studentTableBody');
  tbody.innerHTML=`<tr><td colspan="7" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr>`;
  const {page,perPage,search,status,sortCol,sortOrder}=state.list;
  const p=new URLSearchParams({page,per_page:perPage,sort:sortCol,order:sortOrder});
  if(search) p.set('search',search);
  if(status) p.set('status',status);
  try{
    const res=await api('/api/admin/students?'+p);const data=await res.json();
    state.list.total=data.total;state.list.totalPages=data.total_pages;
    renderStudentsTable(data.students);
    renderPagination(data.page,data.total_pages,data.total,data.per_page);
    updateSortHeaders();
    document.getElementById('studentBadge').textContent=data.total;
  }catch{tbody.innerHTML=`<tr><td colspan="7" class="text-center text-danger">Failed to load.</td></tr>`;}
}
function renderStudentsTable(list){
  const tbody=document.getElementById('studentTableBody');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><i class="bi bi-person-x"></i><p>No students found.</p></div></td></tr>`;return;}
  tbody.innerHTML=list.map(s=>`<tr>
    <td><div class="fw-semibold">${esc(s.name)}</div><div class="text-muted" style="font-size:.78rem">${esc(s.email||'')}</div></td>
    <td><code class="text-muted">${esc(s.rollNo)}</code></td>
    <td><span class="badge bg-light text-dark border">${esc(s.department||'—')}</span></td>
    <td><strong>${s.cgpa||'—'}</strong></td>
    <td>${statusBadge(s.placementStatus)}</td>
    <td>${s.resumeFile?`<a href="/resume/${esc(s.resumeFile)}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="bi bi-file-pdf me-1"></i>View</a>`:`<span class="text-muted small">Not uploaded</span>`}</td>
    <td><button class="btn btn-sm btn-outline-danger" onclick="openDeleteStudent('${esc(s.rollNo)}','${esc(s.name)}')"><i class="bi bi-trash"></i></button></td>
  </tr>`).join('');
}
function statusBadge(s){const m={'Placed':'bg-success','Registered':'bg-secondary','Shortlisted':'bg-warning text-dark','Interview Scheduled':'bg-info text-dark','Rejected':'bg-danger','Profile Incomplete':'bg-light text-dark border'};return `<span class="badge ${m[s]||'bg-secondary'}">${esc(s||'—')}</span>`;}
function renderPagination(page,totalPages,total,perPage){
  const from=total===0?0:(page-1)*perPage+1,to=Math.min(page*perPage,total);
  document.getElementById('tableInfo').textContent=`Showing ${from}–${to} of ${total} students`;
  const ul=document.getElementById('paginationContainer');
  if(totalPages<=1){ul.innerHTML='';return;}
  const btn=(p,label,disabled=false,active=false)=>`<li class="page-item ${disabled?'disabled':''} ${active?'active':''}"><a class="page-link" href="#" onclick="changePage(${p});return false;">${label}</a></li>`;
  let html=btn(page-1,'&laquo;',page===1);
  (totalPages<=7?Array.from({length:totalPages},(_,i)=>i+1):page<=4?[1,2,3,4,5,'…',totalPages]:page>=totalPages-3?[1,'…',totalPages-4,totalPages-3,totalPages-2,totalPages-1,totalPages]:[1,'…',page-1,page,page+1,'…',totalPages])
    .forEach(p=>{ html+=p==='…'?`<li class="page-item disabled"><span class="page-link">…</span></li>`:btn(p,p,false,p===page); });
  html+=btn(page+1,'&raquo;',page===totalPages);
  ul.innerHTML=html;
}
function changePage(p){if(p<1||p>state.list.totalPages)return;state.list.page=p;loadStudents();}
function updateSortHeaders(){document.querySelectorAll('.sortable').forEach(th=>{th.classList.remove('sort-asc','sort-desc');if(th.dataset.col===state.list.sortCol)th.classList.add(state.list.sortOrder==='asc'?'sort-asc':'sort-desc');});}

function openDeleteStudent(rollNo,name){
  state.pendingDelRoll=rollNo;
  document.getElementById('deleteStudentPreview').innerHTML=`<strong>${esc(name)}</strong><br><span class="text-muted">Roll: ${esc(rollNo)}</span>`;
  deleteStudentModal.show();
}
async function confirmDeleteStudent(){
  const btn=document.getElementById('confirmDeleteStudentBtn');
  const txt=document.getElementById('delStudText'),spin=document.getElementById('delStudSpinner');
  btn.disabled=true;spin.classList.remove('d-none');txt.textContent='Deleting…';
  try{
    const res=await api('/api/admin/students/'+state.pendingDelRoll,{method:'DELETE'});
    const data=await res.json();
    if(data.success){deleteStudentModal.hide();showToast('Student deleted.','info');loadStudents();if(state.section==='dashboard')loadDashboard();}
    else{showToast(data.message,'error');deleteStudentModal.hide();}
  }catch{showToast('Network error.','error');deleteStudentModal.hide();}
  finally{btn.disabled=false;spin.classList.add('d-none');txt.textContent='Delete';state.pendingDelRoll=null;}
}

// ── Companies ────────────────────────────────────────────────
async function loadCompanies(){
  const container=document.getElementById('companyCards');
  container.innerHTML=`<div class="col-12 text-center py-4"><span class="spinner-border me-2"></span>Loading…</div>`;
  try{
    const res=await api('/api/admin/companies');const data=await res.json();
    document.getElementById('companyBadge').textContent=data.companies.length;
    if(!data.companies.length){container.innerHTML=`<div class="col-12"><div class="empty-state"><i class="bi bi-building-x"></i><p>No companies yet.</p></div></div>`;return;}
    container.innerHTML=data.companies.map(c=>`
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
          <div class="company-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="openEditCompany(${JSON.stringify(c)})"><i class="bi bi-pencil me-1"></i>Edit</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteCompany('${esc(c._id)}','${esc(c.name)}')"><i class="bi bi-trash me-1"></i>Delete</button>
          </div>
        </div>
      </div>`).join('');
  }catch(e){console.error(e);}
}
function driveBadge(s){return {Upcoming:'bg-info text-dark',Ongoing:'bg-warning text-dark',Completed:'bg-success'}[s]||'bg-secondary';}

function setupCompanyModal(){
  document.getElementById('saveCompanyBtn').addEventListener('click',handleSaveCompany);
  document.getElementById('companyModal').addEventListener('hidden.bs.modal',()=>{
    state.editCompanyId=null;
    document.getElementById('companyModalTitle').innerHTML='<i class="bi bi-building-add me-2 text-primary"></i>Add Company';
    document.getElementById('saveCompanyText').textContent='Save';
    ['cName','cIndustry','cVisitDate','cCTC','cEligibility','cRoles','cDesc'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('cStatus').value='Upcoming';
    hideAlert('companyFormAlert');
    document.getElementById('companyLoginInfo').classList.add('d-none');
  });
}
function openAddCompanyModal(){state.editCompanyId=null;companyModal.show();}
function openEditCompany(c){
  state.editCompanyId=c._id;
  document.getElementById('companyModalTitle').innerHTML='<i class="bi bi-pencil-fill me-2 text-primary"></i>Edit Company';
  document.getElementById('saveCompanyText').textContent='Save Changes';
  document.getElementById('cName').value=c.name||'';document.getElementById('cIndustry').value=c.industry||'';
  document.getElementById('cVisitDate').value=c.visitDate||'';document.getElementById('cCTC').value=c.ctcLPA||'';
  document.getElementById('cEligibility').value=c.eligibilityCGPA||'';document.getElementById('cStatus').value=c.driveStatus||'Upcoming';
  document.getElementById('cRoles').value=c.openRoles||'';document.getElementById('cDesc').value=c.description||'';
  companyModal.show();
}
async function handleSaveCompany(){
  const btn=document.getElementById('saveCompanyBtn'),txt=document.getElementById('saveCompanyText'),spin=document.getElementById('saveCompanySpinner');
  hideAlert('companyFormAlert');document.getElementById('companyLoginInfo').classList.add('d-none');
  const payload={name:document.getElementById('cName').value.trim(),industry:document.getElementById('cIndustry').value.trim(),visitDate:document.getElementById('cVisitDate').value,ctcLPA:document.getElementById('cCTC').value||0,eligibilityCGPA:document.getElementById('cEligibility').value||0,driveStatus:document.getElementById('cStatus').value,openRoles:document.getElementById('cRoles').value.trim(),description:document.getElementById('cDesc').value.trim()};
  if(!payload.name){showAlert('companyFormAlert','Company name is required.','danger');return;}
  btn.disabled=true;spin.classList.remove('d-none');txt.textContent='Saving…';
  try{
    const url=state.editCompanyId?'/api/admin/companies/'+state.editCompanyId:'/api/admin/companies';
    const method=state.editCompanyId?'PUT':'POST';
    const res=await api(url,{method,body:JSON.stringify(payload)});const data=await res.json();
    if(data.success){
      if(data.login){document.getElementById('companyLoginInfo').innerHTML=`<i class="bi bi-info-circle me-1"></i>Company login created — Username: <strong>${data.login.username}</strong> / Password: <strong>${data.login.password}</strong>`;document.getElementById('companyLoginInfo').classList.remove('d-none');}
      else{companyModal.hide();}
      showToast(state.editCompanyId?'Company updated!':'Company added!','success');
      loadCompanies();loadDashboard();
    }else showAlert('companyFormAlert',data.message||'Failed.','danger');
  }catch{showAlert('companyFormAlert','Network error.','danger');}
  finally{btn.disabled=false;spin.classList.add('d-none');txt.textContent=state.editCompanyId?'Save Changes':'Save';}
}
async function deleteCompany(id,name){
  if(!confirm(`Delete "${name}"?`))return;
  try{const res=await api('/api/admin/companies/'+id,{method:'DELETE'});const data=await res.json();
    if(data.success){showToast('Company deleted.','info');loadCompanies();loadDashboard();}
    else showToast(data.message,'error');
  }catch{showToast('Network error.','error');}
}

// ── Create Student Account ───────────────────────────────────
async function createStudentAccount(){
  const name=document.getElementById('newStudentName').value.trim();
  const roll=document.getElementById('newStudentRoll').value.trim();
  const btn=document.getElementById('createAccText'),spin=document.getElementById('createAccSpinner');
  hideAlert('createAccountAlert');
  if(!name||!roll){showAlert('createAccountAlert','Name and roll number are required.','danger');return;}
  spin.classList.remove('d-none');btn.textContent='Creating…';
  try{
    const res=await api('/api/admin/create-student',{method:'POST',body:JSON.stringify({name,rollNo:roll})});
    const data=await res.json();
    if(data.success){
      document.getElementById('createdName').textContent=name;
      document.getElementById('createdUser').textContent=data.login.username;
      document.getElementById('createdPass').textContent=data.login.password;
      document.getElementById('createdAccountBox').classList.remove('d-none');
      document.getElementById('newStudentName').value='';document.getElementById('newStudentRoll').value='';
      showToast('Account created!','success');
    }else showAlert('createAccountAlert',data.message||'Failed.','danger');
  }catch{showAlert('createAccountAlert','Network error.','danger');}
  finally{spin.classList.add('d-none');btn.textContent='Create Account';}
}

// ── CSV Export ───────────────────────────────────────────────
function setupExport(){
  document.getElementById('exportBtn').addEventListener('click',async()=>{
    try{
      const res=await api('/api/admin/students?per_page=10000');const data=await res.json();
      const rows=[['Name','Roll No','Dept','CGPA','Email','Phone','Skills','Status','Company','Package LPA','Resume']];
      data.students.forEach(s=>rows.push([s.name,s.rollNo,s.department,s.cgpa,s.email||'',s.phone||'',s.skills||'',s.placementStatus,s.placedCompany||'',s.packageLPA||0,s.resumeFile?'Yes':'No']));
      const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='placement_students.csv';a.click();
      showToast('Exported!','success');
    }catch{showToast('Export failed.','error');}
  });
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
