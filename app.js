import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, setDoc, deleteDoc, onSnapshot, collection
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- utilidades ---------- */
const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const hm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const dur = (m, sign = false) => {
  const neg = m < 0; const a = Math.abs(Math.round(m));
  return `${neg ? "-" : sign && m > 0 ? "+" : ""}${Math.floor(a / 60)}h${pad(a % 60)}`;
};
const cls = (m) => (m > 0 ? "pos" : m < 0 ? "neg" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseSigned = (str) => {
  const m = /^\s*([+-])?\s*(\d{1,3}):(\d{2})\s*$/.exec(str || "");
  if (!m) return null;
  const v = +m[2] * 60 + +m[3];
  return m[1] === "-" ? -v : v;
};
const fmtSigned = (min) => `${min < 0 ? "-" : ""}${Math.floor(Math.abs(min) / 60)}:${pad(Math.abs(min) % 60)}`;
const longDate = (k) => new Date(k + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

let toastTimer;
function toast(msg, actionLabel, onAction) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("act", !!actionLabel);
  if (actionLabel) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = actionLabel;
    b.onclick = () => { t.classList.remove("on"); onAction(); };
    t.appendChild(b);
  }
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), actionLabel ? 8000 : 2400);
}

/* ---------- estado ---------- */
const DEF = { dailyMin: 480, workDays: [1, 2, 3, 4, 5], tol: 10, initial: 0 };
const now0 = new Date();
const state = {
  user: null, cfg: { ...DEF }, days: {}, adj: {}, adjId: null,
  ym: { y: now0.getFullYear(), m: now0.getMonth() },
  tab: "hoje", editKey: null, draft: null
};
let auth, db, unsubs = [];

/* ---------- cálculo ---------- */
function calcDay(key, rec) {
  const cfg = state.cfg;
  const date = new Date(key + "T00:00:00");
  const isToday = key === todayKey();
  const expected = rec?.off || !cfg.workDays.includes(date.getDay()) ? 0 : cfg.dailyMin;
  const p = [...(rec?.punches || [])].sort();
  let worked = 0, open = false;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i + 1]) worked += toMin(p[i + 1]) - toMin(p[i]);
    else { open = true; if (isToday) worked += Math.max(0, nowMin() - toMin(p[i])); }
  }
  let diff = p.length ? worked - expected : 0;
  if (p.length && expected > 0 && Math.abs(diff) <= cfg.tol) diff = 0;
  return { p, worked, expected, diff, open, isToday, incomplete: open && !isToday };
}

// Dias incompletos (falta uma saída) ficam fora da conta até serem corrigidos.
// Hoje só entra quando já passou da jornada.
function totals(prefix) {
  let worked = 0, expected = 0, diff = 0;
  for (const k in state.days) {
    if (prefix && !k.startsWith(prefix)) continue;
    const r = calcDay(k, state.days[k]);
    if (!r.p.length || r.incomplete) continue;
    if (r.isToday && r.diff <= 0) continue;
    worked += r.worked; expected += r.expected; diff += r.diff;
  }
  return { worked, expected, diff };
}

const adjTotal = () => Object.values(state.adj).reduce((s, a) => s + (a.minutes || 0), 0);
const bankNow = () => state.cfg.initial + totals("").diff + adjTotal();

/* ---------- telas ---------- */
function show(id) {
  ["#setup", "#auth", "#app"].forEach((s) => ($(s).hidden = s !== id));
}

function setTab(tab) {
  state.tab = tab;
  ["hoje", "hist", "cfg"].forEach((t) => ($("#v-" + t).hidden = t !== tab));
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === tab));
  if (tab === "cfg") fillCfg();
  window.scrollTo(0, 0);
  render();
}

function render() {
  if (!state.user) return;
  if (state.tab === "hoje") renderHoje();
  if (state.tab === "hist") renderHist();
}

function renderHoje() {
  const k = todayKey();
  const r = calcDay(k, state.days[k]);
  const n = r.p.length;
  $("#date").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  $("#punchTitle").textContent = n % 2 ? "Registrar saída" : "Registrar entrada";
  $("#punchSub").textContent = n ? `Último: ${r.p[n - 1]}` : "Toque para bater o ponto";

  const pct = r.expected ? r.worked / r.expected : r.worked > 0 ? 1 : 0;
  const prog = $("#prog");
  prog.style.strokeDashoffset = 552.9 * (1 - Math.min(pct, 1));
  prog.classList.toggle("done", pct >= 1);

  let st = "Nenhum registro hoje.";
  if (n && r.open) {
    st = `Trabalhando desde ${r.p[n - 1]}.`;
    if (r.expected) {
      const left = r.expected - r.worked;
      st += left > 0 ? ` Jornada completa às ${hm((nowMin() + left) % 1440)}, sem mais pausas.` : ` Jornada cumprida, as extras estão correndo.`;
    }
  } else if (n) st = `Fora do expediente desde ${r.p[n - 1]}.`;
  $("#status").textContent = st;

  $("#sWorked").textContent = dur(r.worked);
  const dayDiff = n ? r.worked - r.expected : 0;
  $("#sDayLbl").textContent = dayDiff < 0 ? "Falta hoje" : "Extra hoje";
  const sd = $("#sDay"); sd.textContent = dur(Math.abs(dayDiff)); sd.className = cls(dayDiff);
  const mo = totals(`${now0.getFullYear()}-${pad(now0.getMonth() + 1)}`);
  const sm = $("#sMonth"); sm.textContent = dur(mo.diff, true); sm.className = cls(mo.diff);
  const bank = bankNow();
  const sb = $("#sBank"); sb.textContent = dur(bank, true); sb.className = cls(bank);

  $("#btnUndo").hidden = !n;
  $("#todayList").innerHTML = n
    ? r.p.map((t, i) => `<li><span>${i % 2 ? "Saída" : "Entrada"}</span><b>${t}</b></li>`).join("")
    : `<li class="empty" style="border:0">Sem registros. Toque no botão para marcar sua entrada.</li>`;
}

function renderHist() {
  const { y, m } = state.ym;
  const prefix = `${y}-${pad(m + 1)}`;
  $("#mTitle").textContent = new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const t = totals(prefix);
  $("#hWorked").textContent = dur(t.worked);
  $("#hExp").textContent = dur(t.expected);
  const hb = $("#hBal"); hb.textContent = dur(t.diff, true); hb.className = cls(t.diff);
  const bank = bankNow();
  const hk = $("#hBank"); hk.textContent = dur(bank, true); hk.className = cls(bank);

  const adjs = Object.entries(state.adj).filter(([, a]) => a.date?.startsWith(prefix)).sort((a, b) => b[1].date.localeCompare(a[1].date));
  $("#adjWrap").hidden = !adjs.length;
  $("#adjList").innerHTML = adjs.map(([id, a]) => `<li data-a="${id}">
      <div class="d">${a.date.slice(8)}<small>${WD[new Date(a.date + "T00:00:00").getDay()]}</small></div>
      <div class="t">${a.minutes < 0 ? "Baixa" : "Crédito"}${a.note ? `<em>${esc(a.note)}</em>` : ""}</div>
      <div class="s ${cls(a.minutes)}">${dur(a.minutes, true)}</div>
    </li>`).join("");

  const today = todayKey();
  const last = new Date(y, m + 1, 0).getDate();
  let html = "";
  for (let d = last; d >= 1; d--) {
    const k = `${prefix}-${pad(d)}`;
    if (k > today) continue;
    const rec = state.days[k];
    const r = calcDay(k, rec);
    const dim = !r.p.length && !r.expected && !rec?.off;
    const sub = [rec?.off ? "Folga/abono" : "", rec?.note ? esc(rec.note) : ""].filter(Boolean).join(" · ");
    const counted = !r.incomplete && !(r.isToday && r.diff <= 0);
    html += `<li data-k="${k}" class="${dim ? "dim" : ""}">
      <div class="d">${d}<small>${WD[new Date(k + "T00:00:00").getDay()]}</small></div>
      <div class="t">${r.p.length ? r.p.join("  ") : '<span class="mute">Sem registro</span>'}${sub ? `<em>${sub}</em>` : ""}${r.incomplete ? '<em class="warn">Falta uma saída. Toque para corrigir.</em>' : ""}</div>
      <div class="s ${r.p.length && counted ? cls(r.diff) : ""}">${r.p.length ? dur(r.worked) : ""}${r.p.length && counted ? `<small>${dur(r.diff, true)}</small>` : ""}</div>
    </li>`;
  }
  $("#days").innerHTML = html || `<li class="empty" style="border:0;cursor:default">Nenhum dia neste mês ainda.</li>`;
}

/* ---------- ações ---------- */
function saveDay(k, rec) {
  const ref = doc(db, `users/${state.user.uid}/days/${k}`);
  const empty = !(rec.punches?.length) && !rec.off && !rec.note;
  const op = empty ? deleteDoc(ref) : setDoc(ref, { punches: rec.punches || [], off: !!rec.off, note: rec.note || "" });
  // Sem await de propósito: offline, o Firestore guarda localmente e envia depois.
  op.catch((e) => toast("Não foi possível salvar: " + e.message));
}

$("#punch").onclick = async () => {
  const t = nowHM(); // hora do toque, antes de pedir a biometria
  const k = todayKey();
  if (store.get(K_PUNCH) === "1" && !(await verifyBio())) { toast("Biometria não confirmada."); return; }
  const rec = state.days[k] || {};
  const p = [...(rec.punches || [])];
  if (p.includes(t)) { toast("Já existe um registro neste minuto."); return; }
  p.push(t); p.sort();
  saveDay(k, { ...rec, punches: p });
  navigator.vibrate?.(30);
  toast(`${p.length % 2 ? "Entrada" : "Saída"} registrada às ${t}`, "Desfazer", () => { removePunch(k, t); toast("Batida desfeita"); });
};

function removePunch(k, t) {
  const rec = state.days[k] || {};
  saveDay(k, { ...rec, punches: (rec.punches || []).filter((x) => x !== t) });
}
$("#btnUndo").onclick = () => {
  const k = todayKey();
  const p = [...(state.days[k]?.punches || [])].sort();
  if (!p.length) return;
  const t = p[p.length - 1];
  if (!confirm(`Desfazer a batida das ${t}?`)) return;
  removePunch(k, t);
  toast("Batida desfeita");
};

document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$("#mPrev").onclick = () => { const d = new Date(state.ym.y, state.ym.m - 1, 1); state.ym = { y: d.getFullYear(), m: d.getMonth() }; renderHist(); };
$("#mNext").onclick = () => { const d = new Date(state.ym.y, state.ym.m + 1, 1); state.ym = { y: d.getFullYear(), m: d.getMonth() }; renderHist(); };
$("#days").onclick = (e) => { const li = e.target.closest("li[data-k]"); if (li) openEdit(li.dataset.k); };

/* ---------- edição de um dia ---------- */
function openEdit(k) {
  const rec = state.days[k] || {};
  state.editKey = k;
  state.draft = { punches: [...(rec.punches || [])].sort(), off: !!rec.off, note: rec.note || "" };
  $("#dTitle").textContent = longDate(k);
  $("#dOff").checked = state.draft.off;
  $("#dNote").value = state.draft.note;
  drawRows();
  $("#dlg").showModal();
}
function drawRows() {
  const p = state.draft.punches;
  $("#dRows").innerHTML = p.length
    ? p.map((t, i) => `<div class="drow"><span>${i % 2 ? "Saída" : "Entrada"}</span><input type="time" value="${t}" data-i="${i}"><button type="button" class="ghost" data-del="${i}" aria-label="Remover horário">✕</button></div>`).join("")
    : `<p class="empty">Nenhum horário neste dia.</p>`;
}
$("#dRows").addEventListener("input", (e) => { if (e.target.dataset.i != null) state.draft.punches[+e.target.dataset.i] = e.target.value; });
$("#dRows").addEventListener("click", (e) => {
  const i = e.target.dataset.del;
  if (i != null) { state.draft.punches.splice(+i, 1); drawRows(); }
});
$("#dAdd").onclick = () => {
  state.draft.punches.push("");
  drawRows();
  const inputs = $("#dRows").querySelectorAll("input"); inputs[inputs.length - 1]?.focus();
};
$("#dCancel").onclick = () => $("#dlg").close();
$("#dSave").onclick = () => {
  const p = [...new Set(state.draft.punches.filter((v) => /^\d{2}:\d{2}$/.test(v)))].sort();
  saveDay(state.editKey, { punches: p, off: $("#dOff").checked, note: $("#dNote").value.trim() });
  $("#dlg").close();
  toast("Dia salvo");
};
$("#dClear").onclick = () => {
  if (!confirm("Apagar todos os registros deste dia?")) return;
  saveDay(state.editKey, { punches: [], off: false, note: "" });
  $("#dlg").close();
};

/* ---------- baixas e créditos no banco de horas ---------- */
function openAdj(id) {
  const a = id ? state.adj[id] : null;
  state.adjId = id || null;
  $("#aTitle").textContent = id ? "Editar lançamento" : "Lançar no banco de horas";
  $("#aType").value = a && a.minutes > 0 ? "credito" : "baixa";
  $("#aTime").value = a ? fmtSigned(Math.abs(a.minutes)) : "";
  $("#aDate").value = a?.date || todayKey();
  $("#aNote").value = a?.note || "";
  $("#aDel").hidden = !id;
  $("#adlg").showModal();
}
$("#btnAdj").onclick = () => openAdj(null);
$("#adjList").onclick = (e) => { const li = e.target.closest("li[data-a]"); if (li) openAdj(li.dataset.a); };
$("#aCancel").onclick = () => $("#adlg").close();
$("#aSave").onclick = () => {
  let s = ($("#aTime").value || "").trim().toLowerCase().replace("h", ":");
  if (/^\d+$/.test(s)) s += ":00";
  if (/^\d+:$/.test(s)) s += "00";
  const v = parseSigned(s);
  if (v === null || v <= 0) return toast("Informe as horas, como 8:00.");
  const date = $("#aDate").value;
  if (!date) return toast("Escolha a data.");
  const minutes = $("#aType").value === "baixa" ? -v : v;
  const id = state.adjId || Date.now().toString(36);
  setDoc(doc(db, `users/${state.user.uid}/adjustments/${id}`), { date, minutes, note: $("#aNote").value.trim() })
    .catch((e) => toast("Não foi possível salvar: " + e.message));
  $("#adlg").close();
  const [y, m] = date.split("-").map(Number);
  state.ym = { y, m: m - 1 };
  toast("Lançamento salvo");
};
$("#aDel").onclick = () => {
  if (!confirm("Excluir este lançamento?")) return;
  deleteDoc(doc(db, `users/${state.user.uid}/adjustments/${state.adjId}`)).catch((e) => toast("Erro: " + e.message));
  $("#adlg").close();
};

/* ---------- ajustes ---------- */
$("#cDays").innerHTML = WD.map((n, i) => `<label><input type="checkbox" value="${i}"> ${n}</label>`).join("");
function fillCfg() {
  const c = state.cfg;
  $("#cDaily").value = hm(c.dailyMin);
  $("#cTol").value = c.tol;
  $("#cInit").value = fmtSigned(c.initial);
  document.querySelectorAll("#cDays input").forEach((i) => (i.checked = c.workDays.includes(+i.value)));
  $("#cUser").textContent = state.user?.email || "";
  syncBio();
}
$("#cSave").onclick = () => {
  const daily = $("#cDaily").value;
  const init = parseSigned($("#cInit").value);
  if (!/^\d{2}:\d{2}$/.test(daily) || toMin(daily) <= 0) return toast("Informe as horas por dia, como 08:00.");
  if (init === null) return toast("Saldo inicial inválido. Use o formato 2:30 ou -2:30.");
  const cfg = {
    dailyMin: toMin(daily),
    workDays: [...document.querySelectorAll("#cDays input:checked")].map((i) => +i.value),
    tol: Math.max(0, parseInt($("#cTol").value, 10) || 0),
    initial: init
  };
  setDoc(doc(db, `users/${state.user.uid}/settings/config`), cfg).catch((e) => toast("Erro ao salvar: " + e.message));
  state.cfg = cfg; render();
  toast("Ajustes salvos");
};
$("#btnOut").onclick = () => signOut(auth);

/* ---------- CSV ---------- */
$("#btnCsv").onclick = () => {
  const { y, m } = state.ym;
  const prefix = `${y}-${pad(m + 1)}`;
  const rows = [["Data", "Dia", "Registros", "Trabalhado", "Previsto", "Saldo", "Observação"]];
  const last = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const k = `${prefix}-${pad(d)}`;
    if (k > todayKey()) break;
    const rec = state.days[k]; const r = calcDay(k, rec);
    if (!r.p.length && !rec?.off) continue;
    rows.push([`${pad(d)}/${pad(m + 1)}/${y}`, WD[new Date(k + "T00:00:00").getDay()], r.p.join(" "),
      dur(r.worked), dur(r.expected), r.incomplete ? "incompleto" : dur(r.diff, true), (rec?.off ? "Folga/abono " : "") + (rec?.note || "")]);
  }
  Object.values(state.adj).filter((a) => a.date?.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date)).forEach((a) => {
    const [yy, mm, dd] = a.date.split("-");
    rows.push([`${dd}/${mm}/${yy}`, "", "", "", "", dur(a.minutes, true), `${a.minutes < 0 ? "Baixa" : "Crédito"} no banco ${a.note || ""}`.trim()]);
  });
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `ponto-${prefix}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
};

/* ---------- login ---------- */
const AUTH_ERR = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/missing-password": "Digite a senha.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/email-already-in-use": "Este e-mail já tem conta. Toque em Entrar.",
  "auth/too-many-requests": "Muitas tentativas. Tente de novo em alguns minutos.",
  "auth/network-request-failed": "Sem conexão com a internet.",
  "auth/operation-not-allowed": "Este método de login não está ativado no Firebase.",
  "auth/unauthorized-domain": "Este endereço não está autorizado no Firebase (veja o README)."
};
const authFail = (e) => { $("#authErr").textContent = e.code in AUTH_ERR ? AUTH_ERR[e.code] : e.code === "auth/popup-closed-by-user" ? "" : "Erro: " + e.message; };
$("#btnLogin").onclick = () => signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#pass").value).catch(authFail);
$("#btnSignup").onclick = () => createUserWithEmailAndPassword(auth, $("#email").value.trim(), $("#pass").value).catch(authFail);
$("#btnGoogle").onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(authFail);
$("#btnReset").onclick = () => {
  const e = $("#email").value.trim();
  if (!e) { $("#authErr").textContent = "Digite seu e-mail acima para receber o link."; return; }
  sendPasswordResetEmail(auth, e).then(() => { $("#authErr").textContent = ""; toast("Link enviado para o seu e-mail"); }).catch(authFail);
};

/* ---------- biometria (rosto ou digital do celular) ---------- */
// Trava local: o celular confere o rosto/digital (WebAuthn). Nada biométrico sai do aparelho.
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};
const K_CRED = "ponto.cred", K_PUNCH = "ponto.bioPunch";
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
let verifying = false;

async function verifyBio() {
  const id = store.get(K_CRED);
  if (!id) return true;
  if (verifying) return false;
  verifying = true;
  try {
    await navigator.credentials.get({ publicKey: {
      challenge: rnd(32), timeout: 60000, userVerification: "required",
      allowCredentials: [{ type: "public-key", id: unb64(id), transports: ["internal"] }]
    } });
    return true;
  } catch { return false; }
  finally { verifying = false; }
}

async function tryUnlock() {
  if (await verifyBio()) $("#lock").hidden = true;
}
function lockNow() {
  if (!store.get(K_CRED)) return;
  $("#lock").hidden = false;
  tryUnlock();
}
$("#lockBtn").onclick = tryUnlock;
$("#lockOut").onclick = () => {
  if (!confirm("Sair da conta e remover o bloqueio deste aparelho? Você vai precisar entrar de novo com e-mail e senha.")) return;
  store.del(K_CRED); store.del(K_PUNCH);
  $("#lock").hidden = true;
  if (auth) signOut(auth);
};

let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60000) lockNow(); // voltou depois de mais de 1 minuto
});

function syncBio() {
  const has = !!store.get(K_CRED);
  $("#bioLock").checked = has;
  $("#bioPunch").checked = has && store.get(K_PUNCH) === "1";
  $("#bioPunch").disabled = !has;
}
$("#bioLock").onchange = async (e) => {
  const box = e.target;
  if (box.checked) {
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: rnd(32), timeout: 60000,
        rp: { name: "Ponto" },
        user: { id: rnd(16), name: state.user?.email || "usuario", displayName: "Ponto" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" }
      } });
      store.set(K_CRED, b64(cred.rawId));
      toast("Bloqueio ativado");
    } catch { toast("Não foi possível ativar neste aparelho."); }
  } else {
    if (!(await verifyBio())) { toast("Biometria não confirmada."); syncBio(); return; }
    store.del(K_CRED); store.del(K_PUNCH);
    toast("Bloqueio desativado");
  }
  syncBio();
};
$("#bioPunch").onchange = (e) => { e.target.checked ? store.set(K_PUNCH, "1") : store.del(K_PUNCH); };

(window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? Promise.resolve(false)).then((ok) => {
  $("#bioNo").hidden = ok;
  if (!ok && !store.get(K_CRED)) $("#bioLock").disabled = true;
}).catch(() => {});

lockNow(); // ao abrir o app

/* ---------- instalar ---------- */
let deferredInstall;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; $("#btnInstall").hidden = false; });
$("#btnInstall").onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#btnInstall").hidden = true; };
if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone) $("#iosHint").hidden = false;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------- início ---------- */
if (!firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith("COLE")) {
  show("#setup");
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

  onAuthStateChanged(auth, (user) => {
    unsubs.forEach((u) => u()); unsubs = [];
    state.user = user;
    if (!user) { state.days = {}; state.adj = {}; show("#auth"); return; }
    show("#app");
    setTab(state.tab);
    unsubs.push(onSnapshot(doc(db, `users/${user.uid}/settings/config`), (s) => {
      state.cfg = { ...DEF, ...(s.data() || {}) };
      if (state.tab === "cfg") fillCfg();
      render();
    }));
    unsubs.push(onSnapshot(collection(db, `users/${user.uid}/adjustments`), (s) => {
      const a = {}; s.forEach((x) => (a[x.id] = x.data()));
      state.adj = a; render();
    }));
    unsubs.push(onSnapshot(collection(db, `users/${user.uid}/days`), (s) => {
      const d = {}; s.forEach((x) => (d[x.id] = x.data()));
      state.days = d; render();
    }));
  });

  let tick = 0;
  setInterval(() => {
    const d = new Date();
    $("#clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (++tick % 20 === 0) render();
  }, 1000);
}
