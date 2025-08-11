from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

DB_NAME = "barbearia.db"

# ---------- Utils ----------
def formatar_telefone(numero: str) -> str:
    numero = ''.join(filter(str.isdigit, numero))
    if len(numero) == 11:
        return f"({numero[:2]}) {numero[2:7]}-{numero[7:]}"
    if len(numero) == 10:
        return f"({numero[:2]}) {numero[2:6]}-{numero[6:]}"
    return numero or ""

def normalizar_data(txt: str) -> str | None:
    if not txt: return None
    raw = txt.strip().lower()
    if raw == "hoje":
        return datetime.today().strftime("%Y-%m-%d")
    if raw in ("amanha","amanhã"):
        return (datetime.today()+timedelta(days=1)).strftime("%Y-%m-%d")
    if raw.isdigit() and len(raw)==8:
        for fmt in ("%d%m%Y","%Y%m%d"):
            try: return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
            except ValueError: pass
        return None
    for fmt in ("%Y-%m-%d","%d/%m/%Y","%d-%m-%Y","%d.%m.%Y","%Y/%m/%d","%Y.%m.%d"):
        try: return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError: pass
    return None

def data_eh_passada(data_iso: str) -> bool:
    try:
        d = datetime.strptime(data_iso, "%Y-%m-%d").date()
        return d < datetime.today().date()
    except Exception:
        return True

def conn():
    c = sqlite3.connect(DB_NAME, timeout=10, check_same_thread=False)
    c.row_factory = sqlite3.Row
    # melhora concorrência e evita "database is locked"
    c.execute("PRAGMA foreign_keys = ON")
    c.execute("PRAGMA journal_mode=WAL")
    return c

def criar_tabelas():
    c = conn(); cur = c.cursor()
    # Tabela principal (com coluna 'servico')
    cur.execute("""
    CREATE TABLE IF NOT EXISTS agendamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_cliente TEXT NOT NULL,
      telefone TEXT NOT NULL,
      data TEXT NOT NULL,
      hora TEXT NOT NULL,
      servico TEXT,
      status TEXT DEFAULT 'agendado',
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    # Migração: adiciona 'servico' se faltar
    cur.execute("PRAGMA table_info(agendamentos)")
    cols = {r["name"] for r in cur.fetchall()}
    if "servico" not in cols:
        cur.execute("ALTER TABLE agendamentos ADD COLUMN servico TEXT")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(data)")
    # evita dois 'agendado' no MESMO slot (data+hora)
    cur.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS ux_ag_slot_agendado
      ON agendamentos(data, hora) WHERE status='agendado'
    """)

    # Bloqueios de DIA
    cur.execute("""
    CREATE TABLE IF NOT EXISTS bloqueios (
      dia TEXT PRIMARY KEY,
      motivo TEXT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_blk_dia ON bloqueios(dia)")
    c.commit(); c.close()

def data_bloqueada(data_iso: str):
    c = conn(); cur = c.cursor()
    cur.execute("SELECT motivo FROM bloqueios WHERE dia = ?", (data_iso,))
    row = cur.fetchone(); c.close()
    return (True, row["motivo"] if row else None) if row else (False, None)

# ---------- Rotas ----------
@app.post("/agendamentos")
def criar_agendamento():
    body = request.get_json(force=True, silent=True) or {}
    nome = (body.get("nome") or "").strip()
    fone = formatar_telefone(body.get("telefone") or "")
    data_iso = normalizar_data(body.get("data") or "")
    hora = (body.get("hora") or "").strip()
    servico = (body.get("servico") or "").strip() or None

    if not (nome and fone and data_iso and hora):
        return jsonify(error="Campos obrigatórios: nome, telefone, data, hora."), 400
    if data_eh_passada(data_iso):
        return jsonify(error="Não é permitido agendar em data passada."), 400
    bloqueada, motivo = data_bloqueada(data_iso)
    if bloqueada:
        return jsonify(error=f"Data bloqueada ({data_iso}). Motivo: {motivo or '—'}"), 409

    try:
        c = conn(); cur = c.cursor()
        # checa conflito com agendado/bloqueado/finalizado
        cur.execute("""SELECT 1 FROM agendamentos
                       WHERE data=? AND hora=? AND status IN ('agendado','bloqueado','finalizado')""",
                    (data_iso, hora))
        if cur.fetchone():
            c.close()
            return jsonify(error="Já existe item nesse horário (agendado/cancelado/finalizado/bloqueado)."), 409

        cur.execute("""INSERT INTO agendamentos (nome_cliente, telefone, data, hora, servico)
                       VALUES (?,?,?,?,?)""", (nome, fone, data_iso, hora, servico))
        c.commit()
        new_id = cur.lastrowid
        c.close()
        return jsonify(id=new_id, nome=nome, telefone=fone, data=data_iso, hora=hora,
                       servico=servico, status="agendado"), 201
    except sqlite3.IntegrityError:
        return jsonify(error="Já existe agendamento neste horário para esse dia."), 409

@app.get("/agendamentos")
def listar_agendamentos():
    data_q = request.args.get("data")
    status_q = request.args.get("status")  # agendado | finalizado | cancelado | bloqueado
    params = []; where = []
    if data_q:
        data_iso = normalizar_data(data_q)
        if not data_iso:
            return jsonify(error="Data inválida."), 400
        where.append("data = ?"); params.append(data_iso)
    if status_q:
        where.append("status = ?"); params.append(status_q)

    sql = "SELECT * FROM agendamentos"
    if where: sql += " WHERE " + " AND ".join(where)
    sql += """ ORDER BY
        CASE status WHEN 'bloqueado' THEN 0 WHEN 'agendado' THEN 1
                    WHEN 'finalizado' THEN 2 WHEN 'cancelado' THEN 3 ELSE 4 END,
        time(hora) ASC, id ASC"""

    c = conn(); cur = c.cursor()
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    c.close()

    if data_q:
        blk, mot = data_bloqueada(normalizar_data(data_q))
    else:
        blk, mot = (False, None)

    return jsonify(items=rows, bloqueio=(blk and {"dia": normalizar_data(data_q), "motivo": mot}) or None)

@app.patch("/agendamentos/<int:ag_id>")
def atualizar_agendamento(ag_id):
    body = request.get_json(force=True, silent=True) or {}

    # Busca estado atual pra montar alvo de conflito
    c = conn(); cur = c.cursor()
    cur.execute("SELECT data, hora, status FROM agendamentos WHERE id=?", (ag_id,))
    atual = cur.fetchone()
    if not atual:
        c.close(); return jsonify(error="Agendamento não encontrado."), 404

    alvo_data = normalizar_data(body.get("data") or "") or atual["data"]
    alvo_hora = (body.get("hora") or "").strip() or atual["hora"]
    alvo_status = (body.get("status") or "").strip() or atual["status"]

    # validações de data/hora/dia bloqueado
    if body.get("data"):
        if not normalizar_data(body["data"]):
            c.close(); return jsonify(error="Data inválida."), 400
        if data_eh_passada(alvo_data):
            c.close(); return jsonify(error="Não é permitido alterar para data passada."), 400
        blk, mot = data_bloqueada(alvo_data)
        if blk:
            c.close(); return jsonify(error=f"Não é permitido alterar para data bloqueada ({alvo_data}). Motivo: {mot or '—'}"), 409

    if body.get("status") and alvo_status not in ("agendado","finalizado","cancelado","bloqueado"):
        c.close(); return jsonify(error="Status inválido."), 400

    # checagem de conflito (ocupados: agendado/bloqueado/finalizado), exclui o próprio id
    cur.execute("""SELECT 1 FROM agendamentos
                   WHERE data=? AND hora=? AND status IN ('agendado','bloqueado','finalizado')
                     AND id <> ?""", (alvo_data, alvo_hora, ag_id))
    if cur.fetchone():
        c.close(); return jsonify(error="Conflito: já existe item nesse horário."), 409

    # monta update dinâmico
    set_parts = []; params = []
    if "nome" in body:
        set_parts.append("nome_cliente = ?"); params.append((body["nome"] or "").strip())
    if "telefone" in body:
        set_parts.append("telefone = ?"); params.append(formatar_telefone(body["telefone"] or ""))
    if "servico" in body:
        set_parts.append("servico = ?"); params.append(((body["servico"] or "").strip() or None))
    if "data" in body:
        set_parts.append("data = ?"); params.append(alvo_data)
    if "hora" in body:
        set_parts.append("hora = ?"); params.append(alvo_hora)
    if "status" in body:
        set_parts.append("status = ?"); params.append(alvo_status)

    if not set_parts:
        c.close(); return jsonify(error="Nada para atualizar."), 400

    params.append(ag_id)
    cur.execute(f"UPDATE agendamentos SET {', '.join(set_parts)} WHERE id = ?", params)
    c.commit(); c.close()
    return jsonify(ok=True)

# -------- Bloqueio de DIA --------
@app.get("/bloqueios")
def get_bloqueios():
    c = conn(); cur = c.cursor()
    cur.execute("SELECT * FROM bloqueios ORDER BY date(dia)")
    rows = [dict(r) for r in cur.fetchall()]
    c.close()
    return jsonify(items=rows)

@app.post("/bloqueios")
def criar_bloqueio():
    body = request.get_json(force=True, silent=True) or {}
    dia = normalizar_data(body.get("dia") or "")
    motivo = (body.get("motivo") or "").strip() or None
    if not dia: return jsonify(error="Dia inválido."), 400
    try:
        c = conn(); cur = c.cursor()
        cur.execute("INSERT INTO bloqueios (dia, motivo) VALUES (?,?)", (dia, motivo))
        c.commit(); c.close()
        return jsonify(dia=dia, motivo=motivo), 201
    except sqlite3.IntegrityError:
        return jsonify(error="Dia já bloqueado."), 409

@app.delete("/bloqueios/<dia>")
def remover_bloqueio(dia):
    dia_iso = normalizar_data(dia)
    if not dia_iso: return jsonify(error="Dia inválido."), 400
    c = conn(); cur = c.cursor()
    cur.execute("DELETE FROM bloqueios WHERE dia = ?", (dia_iso,))
    if cur.rowcount == 0:
        c.close(); return jsonify(error="Bloqueio não encontrado."), 404
    c.commit(); c.close()
    return jsonify(ok=True)

# -------- Bloqueio de HORÁRIO (slot) --------
@app.post("/slots/bloquear")
def bloquear_horario():
    body = request.get_json(force=True, silent=True) or {}
    data_iso = normalizar_data(body.get("data") or "")
    hora = (body.get("hora") or "").strip()
    if not (data_iso and hora):
        return jsonify(error="Campos obrigatórios: data, hora."), 400
    if data_eh_passada(data_iso):
        return jsonify(error="Não é permitido bloquear horário em data passada."), 400
    try:
        c = conn(); cur = c.cursor()
        cur.execute("""SELECT id FROM agendamentos
                       WHERE data=? AND hora=? AND status IN ('agendado','cancelado','finalizado','bloqueado')""",
                    (data_iso, hora))
        if cur.fetchone():
            c.close(); return jsonify(error="Já existe item nesse horário (agendado/cancelado/finalizado/bloqueado)."), 409
        cur.execute("""INSERT INTO agendamentos (nome_cliente, telefone, data, hora, status)
                       VALUES (?,?,?,?, 'bloqueado')""", ("Bloqueado", "", data_iso, hora))
        c.commit(); c.close()
        return jsonify(ok=True), 201
    except sqlite3.IntegrityError:
        return jsonify(error="Conflito no slot."), 409

@app.post("/slots/desbloquear")
def desbloquear_horario():
    body = request.get_json(force=True, silent=True) or {}
    data_iso = normalizar_data(body.get("data") or "")
    hora = (body.get("hora") or "").strip()
    if not (data_iso and hora):
        return jsonify(error="Campos obrigatórios: data, hora."), 400
    c = conn(); cur = c.cursor()
    cur.execute("""DELETE FROM agendamentos WHERE data=? AND hora=? AND status='bloqueado'""",
                (data_iso, hora))
    if cur.rowcount == 0:
        c.close(); return jsonify(error="Esse horário não estava bloqueado."), 404
    c.commit(); c.close()
    return jsonify(ok=True)

# -------- Remoções para Histórico --------
@app.delete("/agendamentos/<int:ag_id>")
def deletar_agendamento(ag_id):
    c = conn(); cur = c.cursor()
    cur.execute("DELETE FROM agendamentos WHERE id=? AND status IN ('finalizado','cancelado')", (ag_id,))
    if cur.rowcount == 0:
        c.close(); return jsonify(error="Só é permitido remover finalizados/cancelados."), 400
    c.commit(); c.close()
    return jsonify(ok=True)

@app.delete("/agendamentos")
def deletar_agendamentos():
    status = request.args.get("status")
    if status != "cancelado":
        return jsonify(error="Para limpeza em massa, use ?status=cancelado"), 400
    c = conn(); cur = c.cursor()
    cur.execute("DELETE FROM agendamentos WHERE status='cancelado'")
    c.commit(); c.close()
    return jsonify(ok=True, removidos=True)

@app.get("/")
def root():
    return "API Barbearia OK (serviço habilitado)"

if __name__ == "__main__":
    criar_tabelas()
    print("Rotas carregadas:", app.url_map)
    app.run(debug=True, port=5000, use_reloader=False)
