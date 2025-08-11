// api.js
const API_BASE = "http://localhost:5000"; // troque a porta se precisar

export async function apiListarDia(dataFlex) {
  const u = new URL(API_BASE + "/agendamentos");
  if (dataFlex) u.searchParams.set("data", dataFlex);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao listar");
  return j; // { items: [...], bloqueio: {dia,motivo} | null }
}

export async function apiCriarAgendamento({ nome, telefone, data }) {
  const r = await fetch(API_BASE + "/agendamentos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, telefone, data })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao agendar");
  return j; // {id, nome, telefone, data, status}
}

export async function apiAtualizarStatus(id, status) {
  const r = await fetch(`${API_BASE}/agendamentos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao atualizar status");
  return j;
}

export async function apiEditarAgendamento(id, payloadParcial) {
  const r = await fetch(`${API_BASE}/agendamentos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloadParcial)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao editar");
  return j;
}

export async function apiListarBloqueios() {
  const r = await fetch(API_BASE + "/bloqueios");
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao listar bloqueios");
  return j; // {items:[{dia,motivo,criado_em}]}
}

export async function apiBloquearDia(dia, motivo) {
  const r = await fetch(API_BASE + "/bloqueios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dia, motivo })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao bloquear");
  return j;
}

export async function apiDesbloquearDia(dia) {
  const r = await fetch(`${API_BASE}/bloqueios/${encodeURIComponent(dia)}`, { method: "DELETE" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Erro ao desbloquear");
  return j;
}
