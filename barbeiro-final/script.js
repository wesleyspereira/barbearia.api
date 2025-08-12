// script.js — Painel do Barbeiro (Agenda + Histórico) — v18
// - Data exibida como DD/MM
// - Bloquear/Desbloquear DIA inteiro
// - Finalizado mantém o slot ocupado
// - Histórico com filtros, remover 1/selecionados/todos cancelados
// - Reagendar com checagem de conflitos
document.addEventListener("DOMContentLoaded", () => {
  const API = "https://barbearia-api-fbmf.onrender.com";

  // ---- ELEMENTOS ----
  const calendario = document.getElementById("calendario-mensal");
  const listaAgendamentos = document.getElementById("lista-agendamentos");
  const tituloDia = document.getElementById("dia-selecionado");
  const mesAtualSpan = document.getElementById("mes-atual");

  // Toolbar do dia
  const btnBloqDia = document.getElementById("btn-bloquear-dia");
  const btnDesbloqDia = document.getElementById("btn-desbloquear-dia");
  const statusDia = document.getElementById("status-dia");

  // HISTÓRICO
  const histGrouped = document.getElementById("hist-grouped");
  const filtroHist = document.getElementById("hist-filter");
  const btnClearSelected = document.getElementById("hist-clear-selected");
  const btnClearAll = document.getElementById("hist-clear-all");

  // ---- CONFIG ----
  const diasSemana = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"];
  const horariosNormais = ["09:00","09:30","10:00","10:30","11:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const horariosExtendidos = [...horariosNormais,"18:00","18:30","19:00","19:30","20:00"];

  let dataAtual = new Date();
  let anoAtual = dataAtual.getFullYear();
  let mesAtual = dataAtual.getMonth();

  // Guarda o dia selecionado (pra toolbar do dia)
  let selectedAgendaDateISO = null;
  let selectedDiaTexto = null;
  let selectedDataFmt = null;

  // ---- UTILS ----
  function toISO(ano, mes0, dia) {
    const m = String(mes0 + 1).padStart(2, "0");
    const d = String(dia).padStart(2, "0");
    return `${ano}-${m}-${d}`;
  }
  function dataBR(date) { return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); }
  function atualizarTituloMes() {
    const nomeMes = new Date(anoAtual, mesAtual).toLocaleString("pt-BR", { month: "long", year: "numeric" });
    mesAtualSpan.textContent = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
  }
  const badge = (status) => {
    const map = { agendado:"🟢 agendado", finalizado:"🔵 finalizado", cancelado:"🔴 cancelado", bloqueado:"⛔ bloqueado" };
    return `<span style="margin-left:8px;opacity:.9">${map[status] || status}</span>`;
  };
  const onlyDigits = (s) => (s || "").replace(/\D/g, "");

  // >>> Helpers de exibição
  const DATE_SEP = "/"; // 12/08
  function isoToDDMM(iso, sep = DATE_SEP) {
    if (!iso || !iso.includes("-")) return iso;
    const [,m,d] = iso.split("-");
    return [d,m].join(sep);
  }
  function fmtHora(h) {
    const [H="00", M="00"] = String(h||"").split(":");
    return `${String(H).padStart(2,"0")}:${String(M).padStart(2,"0")}`;
  }

  // ===== Modal Reagendar =====
  let modalReag = document.getElementById("modal-reagendar");
  let reagInfo = document.getElementById("reag-info");
  let reagData = document.getElementById("reag-data");
  let reagHora = document.getElementById("reag-hora");
  let btnReagSalvar = document.getElementById("reag-salvar");
  let btnReagCancelar = document.getElementById("reag-cancelar");

  // cria modal se não existir no HTML
  if (!modalReag) {
    modalReag = document.createElement("div");
    modalReag.id = "modal-reagendar";
    modalReag.hidden = true;
    modalReag.style.position = "fixed";
    modalReag.style.inset = "0";
    modalReag.style.display = "flex";
    modalReag.style.alignItems = "center";
    modalReag.style.justifyContent = "center";
    modalReag.style.background = "rgba(0,0,0,.6)";
    modalReag.style.zIndex = "9999";
    modalReag.innerHTML = `
      <div class="modal-card" style="background:#1f2937;color:#fff;padding:16px;border-radius:12px;max-width:420px;width:92vw">
        <h3>Reagendar</h3>
        <p id="reag-info" style="opacity:.9"></p>
        <div class="row" style="margin:8px 0">
          <label>Data:
            <input type="date" id="reag-data"/>
          </label>
        </div>
        <div class="row" style="margin:8px 0">
          <label>Hora:
            <select id="reag-hora"></select>
          </label>
        </div>
        <div class="actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
          <button id="reag-cancelar">Cancelar</button>
          <button id="reag-salvar">Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(modalReag);
    reagInfo = document.getElementById("reag-info");
    reagData = document.getElementById("reag-data");
    reagHora = document.getElementById("reag-hora");
    btnReagSalvar = document.getElementById("reag-salvar");
    btnReagCancelar = document.getElementById("reag-cancelar");
  }

  let reagendarTarget = null; // { id, nome, dataISO, hora }
  function abrirModalReagendar({ id, nome, dataISO, hora }) {
    reagendarTarget = { id, nome, dataISO, hora };
    reagInfo.textContent = `${nome} — era ${isoToDDMM(dataISO)} às ${fmtHora(hora)}`;
    reagData.value = dataISO;
    carregarHorasDisponiveis(dataISO, hora);
    modalReag.hidden = false;
  }
  function fecharModalReagendar() {
    modalReag.hidden = true;
    reagendarTarget = null;
    reagHora.innerHTML = "";
  }
  btnReagCancelar?.addEventListener("click", fecharModalReagendar);
  modalReag?.addEventListener("click", (e) => { if (e.target === modalReag) fecharModalReagendar(); });
  reagData?.addEventListener("change", () => { carregarHorasDisponiveis(reagData.value, null); });

  async function carregarHorasDisponiveis(dataISO, preferirHora) {
    reagHora.innerHTML = `<option>Carregando...</option>`;
    try {
      const { items = [], bloqueio = null } = await apiListarDia(dataISO);
      if (bloqueio) { reagHora.innerHTML = `<option value="">Dia bloqueado</option>`; return; }
      const d = new Date(dataISO + "T00:00");
      const texto = diasSemana[d.getDay()];
      const grade = (texto === "sexta" || texto === "sabado") ? horariosExtendidos : horariosNormais;

      // Ocupados: agendado, bloqueado e finalizado
      const ocupados = new Set(items
        .filter(a => ['agendado','bloqueado','finalizado'].includes(a.status))
        .map(a => a.hora));

      reagHora.innerHTML = "";
      for (const h of grade) {
        const opt = document.createElement("option");
        opt.value = opt.textContent = h;
        if (ocupados.has(h)) opt.disabled = true;
        reagHora.appendChild(opt);
      }
      if (preferirHora && !ocupados.has(preferirHora)) reagHora.value = preferirHora;
    } catch {
      reagHora.innerHTML = `<option value="">Erro ao carregar</option>`;
    }
  }

  btnReagSalvar?.addEventListener("click", async () => {
    if (!reagendarTarget) return;
    const novaData = reagData.value;
    const novaHora = reagHora.value;
    if (!novaData || !novaHora) { alert("Escolha data e hora."); return; }

    try {
      await apiAtualizarDataHora(reagendarTarget.id, novaData, novaHora);
      fecharModalReagendar();

      const d = new Date(novaData + "T00:00");
      const diaTexto = diasSemana[d.getDay()];
      const dataFmt = d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" });
      await mostrarAgendamentos(diaTexto, dataFmt, novaData);

      const alvo = Array.from(listaAgendamentos.querySelectorAll("li")).find(li => li.dataset.hora === novaHora);
      if (alvo) {
        alvo.scrollIntoView({ behavior: "smooth", block: "center" });
        const old = alvo.style.outline;
        alvo.style.outline = "2px solid #10b981";
        setTimeout(() => { alvo.style.outline = old || ""; }, 1200);
      }

      if (document.querySelector('.menu-btn.active')?.dataset.section === 'historico') {
        await renderHistorico();
      }
      alert("Reagendado com sucesso!");
    } catch (e) {
      alert(e.message || "Erro ao reagendar.");
    }
  });

  // ---- API HELPERS ----
  async function apiListarDia(dataISO) {
    const u = new URL(API + "/agendamentos");
    u.searchParams.set("data", dataISO);
    const r = await fetch(u);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Erro ao listar");
    return j; // { items, bloqueio }
  }
  async function apiListarTodos(status) {
    const u = new URL(API + "/agendamentos");
    if (status) u.searchParams.set("status", status);
    const r = await fetch(u);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Erro ao listar");
    return j.items || [];
  }
  async function apiAtualizarStatus(id, status) {
    const r = await fetch(`${API}/agendamentos/${id}`, {
      method: "PATCH",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ status })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Erro ao atualizar");
    return j;
  }
  async function apiAtualizarDataHora(id, dataISO, hora) {
    const r = await fetch(`${API}/agendamentos/${id}`, {
      method: "PATCH",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ data: dataISO, hora, status:"agendado" })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Erro ao reagendar");
    return j;
  }
  async function apiBloquearSlot(dataISO, hora) {
    const r = await fetch(API + "/slots/bloquear", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ data: dataISO, hora })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Erro ao bloquear horário");
    return j;
  }
  async function apiDesbloquearSlot(dataISO, hora) {
    const r = await fetch(API + "/slots/desbloquear", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ data: dataISO, hora })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Erro ao desbloquear horário");
    return j;
  }
  async function apiDeletar(id) {
    const r = await fetch(`${API}/agendamentos/${id}`, { method: "DELETE" });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error || `Erro ao remover ${id}`);
    return j;
  }
  async function apiDeletarCancelados() {
    const u = new URL(API + "/agendamentos");
    u.searchParams.set("status","cancelado");
    const r = await fetch(u, { method:"DELETE" });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error || "Erro ao remover cancelados");
    return j;
  }
  // >>> Bloqueio de DIA inteiro
  async function apiCriarBloqueio(diaISO, motivo){
    const r = await fetch(API + "/bloqueios", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ dia: diaISO, motivo: motivo || null })
    });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error || "Erro ao bloquear o dia");
    return j;
  }
  async function apiRemoverBloqueio(diaISO){
    const r = await fetch(`${API}/bloqueios/${diaISO}`, { method:"DELETE" });
    const j = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(j.error || "Erro ao desbloquear o dia");
    return j;
  }

  // ---- CALENDÁRIO / AGENDA ----
  async function gerarCalendario() {
    calendario.innerHTML = "";
    const diasNoMes = new Date(anoAtual, mesAtual + 1, 0).getDate();
    const hoje0 = new Date(); hoje0.setHours(0,0,0,0);

    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dt = new Date(anoAtual, mesAtual, dia);
      const dt0 = new Date(dt); dt0.setHours(0,0,0,0);
      const diaTexto = diasSemana[dt.getDay()];
      if (!["terca","quarta","quinta","sexta","sabado"].includes(diaTexto)) continue;

      const btn = document.createElement("button");
      const dataISO = toISO(anoAtual, mesAtual, dia);
      const dataFmt = dataBR(dt);
      btn.textContent = `${diaTexto}\n${dataFmt}`;

      if (dt0 < hoje0) {
        btn.disabled = true;
        btn.style.backgroundColor = "#b91c1c";
      } else {
        btn.onclick = () => mostrarAgendamentos(diaTexto, dataFmt, dataISO);
      }
      calendario.appendChild(btn);
    }
    atualizarTituloMes();
  }

  async function mostrarAgendamentos(diaTexto, dataFmt, dataISO) {
    // guarda seleção atual para toolbar do dia
    selectedAgendaDateISO = dataISO;
    selectedDiaTexto = diaTexto;
    selectedDataFmt = dataFmt;

    // Título — DD/MM
    tituloDia.textContent = `🗓️Agendamentos - ${isoToDDMM(dataISO)}`;
    listaAgendamentos.innerHTML = "Carregando...";

    // destaca o dia na grade
    document.querySelectorAll("#calendario-mensal button").forEach(b=>{
      b.classList.toggle("selecionado", b.textContent.includes(dataFmt));
    });

    let items = []; let bloqueioDia = null;
    try {
      const { items: its, bloqueio } = await apiListarDia(dataISO);
      items = its || []; bloqueioDia = bloqueio || null;
    } catch (e) {
      listaAgendamentos.innerHTML = `<li style="color:#ffb4b4">${e.message}</li>`;
      return;
    }

    // Toolbar do dia conforme bloqueio
    if (bloqueioDia) {
      btnBloqDia && (btnBloqDia.disabled = true);
      btnDesbloqDia && (btnDesbloqDia.disabled = false);
      statusDia && (statusDia.textContent = `🚫 Dia bloqueado${bloqueioDia.motivo ? ` — ${bloqueioDia.motivo}` : ""}`);
    } else {
      btnBloqDia && (btnBloqDia.disabled = false);
      btnDesbloqDia && (btnDesbloqDia.disabled = true);
      statusDia && (statusDia.textContent = "");
    }

    listaAgendamentos.innerHTML = "";
    if (bloqueioDia) {
      const aviso = document.createElement("li");
      aviso.style.background = "#3a3a3a";
      aviso.style.border = "1px dashed #f0ad4e";
      aviso.textContent = `🚫 DIA BLOQUEADO. Motivo: ${bloqueioDia.motivo || "—"}`;
      listaAgendamentos.appendChild(aviso);
    }

    const horarios = (diaTexto === "sexta" || diaTexto === "sabado") ? horariosExtendidos : horariosNormais;

    for (const h of horarios) {
      // Ocupado: agendado / bloqueado / finalizado
      const ag = items.find(
        a => a.hora === h && ['agendado','bloqueado','finalizado'].includes(a.status)
      );
      const li = document.createElement("li");
      li.dataset.hora = h;

      if (!ag) {
        li.innerHTML = `<strong>${fmtHora(h)}</strong> - Disponível
          <button class="botao-bloquear" onclick="bloquearHorario('${dataISO}','${h}','${diaTexto}','${dataFmt}')">Bloquear</button>`;
      } else if (ag.status === "bloqueado") {
        li.innerHTML = `<strong>${fmtHora(h)}</strong> - Horário bloqueado
          <button class="botao-desbloquear" onclick="desbloquearHorario('${dataISO}','${h}','${diaTexto}','${dataFmt}')">Desbloquear</button>`;
      } else if (ag.status === "finalizado") {
        const svc = ag.servico ? ` • ${ag.servico}` : "";
        li.innerHTML = `<strong>${fmtHora(h)}</strong> - ${ag.nome_cliente} (${ag.telefone})${svc}
          ${badge(ag.status)}
          <span style="margin-left:10px">
            <button onclick="reagendarAg(${ag.id},'${ag.nome_cliente}','${dataISO}','${h}')">Reagendar</button>
            <button onclick="whatsAg('${onlyDigits(ag.telefone)}','${ag.nome_cliente}','${dataFmt}','${fmtHora(h)}','${ag.servico || ""}')">WhatsApp</button>
          </span>
          <div class="muted" style="opacity:.8;margin-top:4px">ID ${ag.id} • criado em ${ag.criado_em}</div>`;
      } else {
        const svc = ag.servico ? ` • ${ag.servico}` : "";
        li.innerHTML = `<strong>${fmtHora(h)}</strong> - ${ag.nome_cliente} (${ag.telefone})${svc}
          ${badge(ag.status)}
          <span style="margin-left:10px">
            <button onclick="finalizarAg(${ag.id},'${dataISO}','${diaTexto}','${dataFmt}')">Finalizar</button>
            <button onclick="cancelarAg(${ag.id},'${dataISO}','${diaTexto}','${dataFmt}')">Cancelar</button>
            <button onclick="reagendarAg(${ag.id},'${ag.nome_cliente}','${dataISO}','${h}')">Reagendar</button>
            <button onclick="whatsAg('${onlyDigits(ag.telefone)}','${ag.nome_cliente}','${dataFmt}','${fmtHora(h)}','${ag.servico || ""}')">WhatsApp</button>
          </span>
          <div class="muted" style="opacity:.8;margin-top:4px">ID ${ag.id} • criado em ${ag.criado_em}</div>`;
      }
      listaAgendamentos.appendChild(li);
    }

    setTimeout(() => {
      listaAgendamentos.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  // ---- HISTÓRICO (AGRUPADO POR DATA) ----
  async function renderHistorico() {
    if (!histGrouped) return;
    histGrouped.innerHTML = "Carregando...";
    try {
      let itens = await apiListarTodos(); // pega todos
      itens = itens.filter(a => a.status !== "bloqueado");

      const f = (filtroHist && filtroHist.value) || "tudo";
      if (f !== "tudo") itens = itens.filter(a => a.status === f);

      const grupos = new Map();
      for (const a of itens) {
        if (!grupos.has(a.data)) grupos.set(a.data, []);
        grupos.get(a.data).push(a);
      }
      const datas = Array.from(grupos.keys()).sort((a,b) => a < b ? 1 : -1);

      if (!datas.length) {
        histGrouped.innerHTML = "<div class='muted' style='padding:8px 16px'>Nenhum registro.</div>";
        return;
      }

      histGrouped.innerHTML = "";
      for (const dataISO of datas) {
        const box = document.createElement("div");
        box.className = "dia-group fade-in";
        const head = document.createElement("div");
        head.className = "dia-head";
        head.style.display = "flex";
        head.style.justifyContent = "space-between";
        head.style.padding = "6px 8px";
        head.innerHTML = `<span>📅 ${isoToDDMM(dataISO)}</span><span>${grupos.get(dataISO).length} registros</span>`;
        box.appendChild(head);

        grupos.get(dataISO).sort((a,b) => (a.hora||"") < (b.hora||"") ? -1 : 1);

        for (const a of grupos.get(dataISO)) {
          const row = document.createElement("div");
          row.className = "item-row fade-in";
          row.style.display = "flex";
          row.style.justifyContent = "space-between";
          row.style.gap = "8px";
          row.style.padding = "6px 8px";

          const ck = (a.status === "cancelado")
            ? `<input type="checkbox" class="ck-cancelado" data-id="${a.id}" title="Selecionar para limpar">`
            : "";

          const showDel = (a.status === "finalizado" || a.status === "cancelado");
          const delBtn = showDel ? `<button data-del-id="${a.id}" class="btn-del" title="Remover do histórico">✖</button>` : "";

          const svc = a.servico ? ` • ${a.servico}` : "";

          row.innerHTML = `
            <div class="item-left">
              ${ck}
              <strong>${fmtHora(a.hora)}</strong> — ${a.nome_cliente} (${a.telefone})${svc} ${badge(a.status)}
            </div>
            <div class="item-right" style="display:flex; gap:6px">
              <button onclick="reagendarAg(${a.id},'${a.nome_cliente}','${a.data}','${a.hora || ""}')">Reagendar</button>
              <button class="btn-whats-hist" onclick="whatsAg('${onlyDigits(a.telefone)}','${a.nome_cliente}','${a.data}','${fmtHora(a.hora || "")}','${a.servico || ""}')">WhatsApp</button>
              ${delBtn}
            </div>`;
          box.appendChild(row);
        }
        histGrouped.appendChild(box);
      }

      // clique no X (remove finalizados/cancelados)
      histGrouped.onclick = async (ev) => {
        const b = ev.target.closest(".btn-del"); if (!b) return;
        const id = b.getAttribute("data-del-id");
        if (!confirm("Remover este registro do histórico?")) return;
        try { await apiDeletar(id); await renderHistorico(); scrollHistorico(); }
        catch (e) { alert(e.message || "Erro."); }
      };

      scrollHistorico();
    } catch (e) {
      histGrouped.innerHTML = `<div style="color:#ffb4b4;padding:8px 16px">${e.message}</div>`;
    }
  }

  function scrollHistorico(){
    histGrouped?.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  // filtro do histórico
  filtroHist?.addEventListener("change", async () => {
    await renderHistorico();
    scrollHistorico();
  });

  // Limpar selecionados (apenas cancelados marcados)
  btnClearSelected?.addEventListener("click", async () => {
    const ids = Array.from(document.querySelectorAll(".ck-cancelado:checked")).map(i => i.dataset.id);
    if (!ids.length) { alert("Nenhum cancelado selecionado."); return; }
    if (!confirm(`Remover ${ids.length} cancelado(s) do histórico?`)) return;
    try {
      for (const id of ids) await apiDeletar(id);
      await renderHistorico();
      scrollHistorico();
    } catch (e) { alert(e.message || "Erro."); }
  });

  // Limpar TODOS os cancelados
  btnClearAll?.addEventListener("click", async () => {
    if (!confirm("Remover TODOS os cancelados do histórico?")) return;
    try { await apiDeletarCancelados(); await renderHistorico(); scrollHistorico(); }
    catch (e) { alert(e.message || "Erro."); }
  });

  // ---- AÇÕES (agenda) ----
  window.finalizarAg = async (id, dataISO, diaTexto, dataFmt) => {
    try {
      await apiAtualizarStatus(id, "finalizado");
      await mostrarAgendamentos(diaTexto, dataFmt, dataISO);
      await renderHistorico();
    }
    catch(e){ alert(e.message); }
  };
  window.cancelarAg = async (id, dataISO, diaTexto, dataFmt) => {
    if (!confirm("Deseja cancelar este agendamento?")) return;
    try {
      await apiAtualizarStatus(id, "cancelado");
      await mostrarAgendamentos(diaTexto, dataFmt, dataISO);
      await renderHistorico();
    }
    catch(e){ alert(e.message); }
  };
  window.bloquearHorario = async (dataISO, hora, diaTexto, dataFmt) => {
    try { await apiBloquearSlot(dataISO, hora); await mostrarAgendamentos(diaTexto, dataFmt, dataISO); }
    catch(e){ alert(e.message); }
  };
  window.desbloquearHorario = async (dataISO, hora, diaTexto, dataFmt) => {
    try { await apiDesbloquearSlot(dataISO, hora); await mostrarAgendamentos(diaTexto, dataFmt, dataISO); }
    catch(e){ alert(e.message); }
  };
  window.whatsAg = (telDigits, nome, dataFmtOrISO, hora, servico) => {
    // dataFmtOrISO pode vir "dd/mm" (agenda) ou "YYYY-MM-DD" (histórico)
    let dataTxt = dataFmtOrISO;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataFmtOrISO)) {
      const parts = dataFmtOrISO.split("-");
      dataTxt = `${parts[2]}/${parts[1]}`; // dd/mm
    }
    const svc = servico ? ` (${servico})` : "";
    const msg = `Olá, ${nome}! Seu horário: ${dataTxt} às ${hora}${svc}. Qualquer mudança me avise.`;
    window.open(`https://wa.me/55${telDigits}?text=${encodeURIComponent(msg)}`, "_blank");
  };
  window.reagendarAg = (id, nome, dataISO, hora) => {
    abrirModalReagendar({ id, nome, dataISO, hora });
  };

  // ---- BOTÕES: Bloquear/Desbloquear DIA ----
  btnBloqDia?.addEventListener("click", async () => {
    if (!selectedAgendaDateISO) { alert("Selecione um dia primeiro."); return; }
    const motivo = prompt("Motivo do bloqueio (opcional):") || null;
    try {
      await apiCriarBloqueio(selectedAgendaDateISO, motivo);
      await mostrarAgendamentos(selectedDiaTexto, selectedDataFmt, selectedAgendaDateISO);
      alert("Dia bloqueado com sucesso!");
    } catch (e) {
      alert(e.message || "Erro ao bloquear o dia.");
    }
  });

  btnDesbloqDia?.addEventListener("click", async () => {
    if (!selectedAgendaDateISO) { alert("Selecione um dia primeiro."); return; }
    if (!confirm("Desbloquear este dia inteiro?")) return;
    try {
      await apiRemoverBloqueio(selectedAgendaDateISO);
      await mostrarAgendamentos(selectedDiaTexto, selectedDataFmt, selectedAgendaDateISO);
      alert("Dia desbloqueado!");
    } catch (e) {
      alert(e.message || "Erro ao desbloquear o dia.");
    }
  });

  // ---- ABAS ----
  document.querySelectorAll(".menu-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".menu-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".secao").forEach(s => s.classList.remove("ativa"));
      const alvo = document.getElementById(btn.dataset.section);
      if (alvo) alvo.classList.add("ativa");

      if (btn.dataset.section === "agenda") {
        tituloDia.textContent = "Selecione um dia";
        listaAgendamentos.innerHTML = "";
        document.getElementById("calendario-mensal")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (btn.dataset.section === "historico") {
        await renderHistorico();
        scrollHistorico();
      }
    });
  });

  // ---- NAVEGAÇÃO DE MESES ----
  document.getElementById("mes-anterior").addEventListener("click", () => {
    mesAtual--; if (mesAtual < 0) { mesAtual = 11; anoAtual--; }
    gerarCalendario();
  });
  document.getElementById("proximo-mes").addEventListener("click", () => {
    mesAtual++; if (mesAtual > 11) { mesAtual = 0; anoAtual++; }
    gerarCalendario();
  });

  // ---- INICIAL ----
  gerarCalendario();
});
