// CLIENTE — calendário + serviços + modal + máscara + confirmação (ICS + WhatsApp)
document.addEventListener("DOMContentLoaded", () => {
  const API = "https://barbearia-api-fbmf.onrender.com";
  const SHOP_WHATS = "5527998099941"; // 55 + DDD + número

  const $ = (id) => document.getElementById(id);
  const calendario = $("calendario-mensal");
  const listaHorarios = $("horarios-disponiveis");
  const tituloDia = $("dia-selecionado");
  const mesAtualTexto = $("mes-atual");
  const btnAnterior = $("anterior");
  const btnProximo = $("proximo");
  const saud = $("saudacao");

  const modal = $("modal-agendar");
  const form = $("form-agendar");
  const inpNome = $("ag-nome");
  const inpTel  = $("ag-telefone");
  const btnCancelar = $("ag-cancelar");
  const btnSalvar   = $("ag-salvar");

  const modalOK = $("modal-sucesso");
  const confResumo = $("conf-resumo");
  const btnICS = $("btn-ics");
  const btnWhats = $("btn-whats");
  const okSucesso = $("ok-sucesso");

  const toastBox = $("toast-container");

  // ===== Serviço (cards) =====
  let servicoSelecionado = null;
  const gridServicos = document.getElementById("servicos-grid");
  if (gridServicos) {
    gridServicos.addEventListener("click", (e) => {
      const card = e.target.closest(".svc-card");
      if (!card) return;
      servicoSelecionado = card.dataset.servico || null;
      gridServicos.querySelectorAll(".svc-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
    });
  }

  // Estado
  let slotAtual = { dataISO: null, hora: null, diaTexto: null };
  let selectedDateISO = null;
  let icsObjectUrl = null;

  const diasSemana = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"];
  const horariosNormais = ["09:00","09:30","10:00","10:30","11:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30"];
  const horariosExtendidos = horariosNormais.concat(["18:00","18:30","19:00","19:30","20:00"]);
  let dataAtual = new Date();

  // ===== API =====
  async function apiListarDia(dataISO) {
    const u = new URL(API + "/agendamentos");
    u.searchParams.set("data", dataISO);
    const r = await fetch(u);
    const j = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j; // {items, bloqueio}
  }
  async function apiCriarAgendamento({ nome, telefone, data, hora, servico }) {
    const r = await fetch(API + "/agendamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, telefone, data, hora, servico })
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }

  // ===== Utils =====
  const toISO = (ano, mes0, dia) =>
    `${ano}-${String(mes0+1).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
  const isoToLocalDate = (iso) => { const [y,m,d]=iso.split("-").map(Number); return new Date(y, m-1, d); };
  const brDataFromISO = (iso) => isoToLocalDate(iso).toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" });
  const nomeMesUpper = (date) => date.toLocaleString("pt-BR",{month:"long"}).toUpperCase();

  function toast(msg, tipo){
    if (!toastBox) { alert(msg); return; }
    const el = document.createElement("div");
    el.className = "toast" + (tipo==="error" ? " error" : tipo==="warn" ? " warn" : "");
    el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(()=> el.remove(), 3200);
  }

  function maskTelefone(v) {
    const d = (v || "").replace(/\D/g, "").slice(0, 11);
    if (d.length <= 10)
      return d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*$/, (_,a,b,c)=>[a&&`(${a}`,a&&") ",b,b&&"-",c].filter(Boolean).join(""));
    return d.replace(/^(\d{0,2})(\d{0,5})(\d{0,4}).*$/, (_,a,b,c)=>[a&&`(${a}`,a&&") ",b,b&&"-",c].filter(Boolean).join(""));
  }
  function telefoneValido(v){ const d=(v||"").replace(/\D/g,""); return d.length===10 || d.length===11; }
  if (inpTel) {
    const applyMask = () => { inpTel.value = maskTelefone(inpTel.value); };
    inpTel.addEventListener("input", applyMask);
    inpTel.addEventListener("blur", applyMask);
    inpTel.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      inpTel.value = maskTelefone(text);
    });
  }

  // ===== Calendário =====
  function gerarCalendario(ano, mes) {
    calendario.innerHTML = "";
    const hoje0 = new Date(); hoje0.setHours(0,0,0,0);
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    mesAtualTexto.textContent = `${nomeMesUpper(new Date(ano, mes))} ${ano}`;

    for (let dia = 1; dia <= diasNoMes; dia++) {
      const data = new Date(ano, mes, dia);
      const diaSemana = diasSemana[data.getDay()];
      if (!["terca","quarta","quinta","sexta","sabado"].includes(diaSemana)) continue;

      const dataISO = toISO(ano, mes, dia);
      const dataFmt = data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

      const btn = document.createElement("button");
      btn.textContent = `${diaSemana}\n${dataFmt}`;
      btn.dataset.date = dataISO;
      if (selectedDateISO === dataISO) btn.classList.add("selecionado");

      const dia0 = new Date(ano, mes, dia); dia0.setHours(0,0,0,0);
      if (dia0 < hoje0) { btn.disabled = true; btn.classList.add("dia-passado"); }
      else { btn.onclick = () => mostrarHorarios(diaSemana, dataISO); }

      calendario.appendChild(btn);
    }
  }

  // ===== Lista/seleção do dia =====
  async function mostrarHorarios(diaTexto, dataISO) {
    const dataFmt = brDataFromISO(dataISO);
    tituloDia.textContent = `⏰ Horários de ${dataFmt}`;
    listaHorarios.innerHTML = "Carregando...";

    selectedDateISO = dataISO;
    document.querySelectorAll("#calendario-mensal button").forEach((b) => {
      b.classList.toggle("selecionado", b.dataset.date === selectedDateISO);
    });

    try {
      const { items = [], bloqueio = null } = await apiListarDia(dataISO);

      if (bloqueio) {
        listaHorarios.innerHTML = `<li style="background:#3a3a3a;border:1px dashed #f0ad4e">🚫 Dia bloqueado. Motivo: ${bloqueio.motivo || "—"}</li>`;
        return;
      }

      const horarios = (diaTexto === "sexta" || diaTexto === "sabado") ? horariosExtendidos : horariosNormais;
      listaHorarios.innerHTML = "";

      for (const h of horarios) {
        // Ocupado se AGENDADO, BLOQUEADO **ou FINALIZADO**
        const item = items.find(
          a => a.hora === h && ['agendado','bloqueado','finalizado'].includes(a.status)
        );
        const li = document.createElement("li");

        if (item) {
          let label = "📌 Reservado";
          if (item.status === "bloqueado")  label = "❌ Indisponível";
          if (item.status === "finalizado") label = "🔵 Finalizado";
          li.innerHTML = `<strong>${h}</strong> - ${label}`;
        } else {
          li.innerHTML = `<strong>${h}</strong> - ✅ Disponível 
            <button class="agendar" data-hora="${h}">Agendar</button>`;
          li.querySelector("button.agendar").addEventListener("click", () => {
            slotAtual = { dataISO, hora: h, diaTexto };
            abrirModalAgendar("", "");
          });
        }
        listaHorarios.appendChild(li);
      }
      setTimeout(() => { listaHorarios.scrollIntoView({ behavior: "smooth" }); }, 100);
    } catch (e) {
      console.error("Falha ao listar dia:", e);
      listaHorarios.innerHTML = `<li style="color:#ffb4b4">Erro ao carregar: ${e.message}</li>`;
    }
  }

  // ===== Modal Agendar =====
  function abrirModalAgendar(nomeDefault="", telDefault=""){
    if (!modal) return;
    modal.style.display = "";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (inpNome) inpNome.value = nomeDefault || "";
    if (inpTel)  inpTel.value  = telDefault  || "";
    setTimeout(() => inpNome && inpNome.focus(), 30);
  }
  function fecharModalAgendar(){
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = "none";
    document.body.style.overflow = "";
    form && form.reset();
    setTimeout(() => { if (!modal.hidden) modal.style.display = ""; }, 0);
  }
  btnCancelar && btnCancelar.addEventListener("click", fecharModalAgendar);
  modal && modal.addEventListener("click", (e) => { if (e.target === modal) fecharModalAgendar(); });
  document.addEventListener("keydown", (e) => { if (!modal?.hidden && e.key === "Escape") fecharModalAgendar(); });

  // ===== Modal Sucesso =====
  function abrirModalSucesso({ nome, telefone, dataISO, hora }) {
    if (!modalOK) return;
    const dataFmt = brDataFromISO(dataISO);
    const svc = servicoSelecionado || "Corte";

    confResumo.textContent = `Nome: ${nome} • Tel: ${maskTelefone(telefone)} • Dia: ${dataFmt} • Hora: ${hora} • Serviço: ${svc}`;

    const msg = `Olá! Acabei de agendar na Barbearia Teodoro's.\n` +
                `Nome: ${nome}\nTelefone: ${maskTelefone(telefone)}\n` +
                `Serviço: ${svc}\nDia: ${dataFmt} às ${hora}.`;
    btnWhats.href = `https://wa.me/${SHOP_WHATS}?text=${encodeURIComponent(msg)}`;

    if (icsObjectUrl) URL.revokeObjectURL(icsObjectUrl);
    const ics = gerarICS({ nome, telefone, dataISO, hora, servico: svc });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    icsObjectUrl = URL.createObjectURL(blob);
    btnICS.href = icsObjectUrl;

    modalOK.style.display = "";
    modalOK.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function fecharModalSucesso(){
    if (!modalOK) return;
    modalOK.hidden = true;
    modalOK.style.display = "none";
    document.body.style.overflow = "";
    if (icsObjectUrl) { URL.revokeObjectURL(icsObjectUrl); icsObjectUrl = null; }
  }
  okSucesso && okSucesso.addEventListener("click", fecharModalSucesso);
  modalOK && modalOK.addEventListener("click", (e) => { if (e.target === modalOK) fecharModalSucesso(); });
  document.addEventListener("keydown", (e) => { if (!modalOK?.hidden && e.key === "Escape") fecharModalSucesso(); });

  function gerarICS({ nome, telefone, dataISO, hora, servico }) {
    const dt = dataISO.replace(/-/g,"") + hora.replace(":","") + "00";
    const now = new Date();
    const dtstamp =
      now.getUTCFullYear().toString() +
      String(now.getUTCMonth()+1).padStart(2,"0") +
      String(now.getUTCDate()).padStart(2,"0") + "T" +
      String(now.getUTCHours()).padStart(2,"0") +
      String(now.getUTCMinutes()).padStart(2,"0") +
      String(now.getUTCSeconds()).padStart(2,"0") + "Z";

    const svc = servico || servicoSelecionado || "Corte";

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Teodoros//Agendamentos//PT-BR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${Date.now()}@teodoros`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dt}`,
      "DURATION:PT30M",
      "SUMMARY:Barbearia Teodoro's - Agendamento",
      `DESCRIPTION:Cliente: ${nome} \\nTelefone: ${maskTelefone(telefone)} \\nServiço: ${svc}`,
      "LOCATION:Barbearia Teodoro's",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
  }

  // Submit do agendamento (ENVIA SERVIÇO)
  form && form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!slotAtual?.dataISO || !slotAtual?.hora) {
      toast("Escolha um dia e horário primeiro.", "warn");
      fecharModalAgendar();
      return;
    }
    const nome = (inpNome?.value || "").trim();
    const telMasked = (inpTel?.value || "").trim();
    const telDigits = telMasked.replace(/\D/g, "");
    if (!nome) { toast("Informe seu nome completo.", "error"); inpNome?.focus(); return; }
    if (!telefoneValido(telMasked)) { toast("Telefone inválido. Use 10 ou 11 dígitos.", "error"); inpTel?.focus(); return; }

    const svc = servicoSelecionado || "Corte";

    btnSalvar && (btnSalvar.disabled = true, btnSalvar.textContent = "Agendando...");
    try {
      await apiCriarAgendamento({
        nome,
        telefone: telDigits,
        data: slotAtual.dataISO,
        hora: slotAtual.hora,
        servico: svc
      });
      toast("✅ Agendamento realizado!");
      fecharModalAgendar();
      abrirModalSucesso({ nome, telefone: telDigits, dataISO: slotAtual.dataISO, hora: slotAtual.hora });
      await mostrarHorarios(slotAtual.diaTexto, slotAtual.dataISO);
    } catch (err) {
      console.error("Falha ao agendar:", err);
      toast("❌ " + (err.message || "Erro ao agendar"), "error");
    } finally {
      btnSalvar && (btnSalvar.disabled = false, btnSalvar.textContent = "Agendar");
    }
  });

  // Navegação de mês
  btnAnterior.onclick = () => {
    selectedDateISO = null;
    dataAtual.setMonth(dataAtual.getMonth() - 1);
    gerarCalendario(dataAtual.getFullYear(), dataAtual.getMonth());
  };
  btnProximo.onclick = () => {
    selectedDateISO = null;
    dataAtual.setMonth(dataAtual.getMonth() + 1);
    gerarCalendario(dataAtual.getFullYear(), dataAtual.getMonth());
  };

  // Saudação
  if (saud) {
    const h = new Date().getHours();
    saud.textContent = h < 12 ? "Bom dia !" : h < 18 ? "Boa tarde !" : "Boa noite !";
  }

  gerarCalendario(dataAtual.getFullYear(), dataAtual.getMonth());
});
