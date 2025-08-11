import sqlite3
from datetime import datetime, timedelta

VERSAO = "1.6-bloqueios"

print(f"=== Barbearia Teodoro's CLI – versão {VERSAO} ===")

# --------- Utils ---------
def formatar_telefone(numero: str) -> str:
    numero = ''.join(filter(str.isdigit, numero))
    if len(numero) == 11:
        return f"({numero[:2]}) {numero[2:7]}-{numero[7:]}"
    elif len(numero) == 10:
        return f"({numero[:2]}) {numero[2:6]}-{numero[6:]}"
    return numero

def normalizar_data(txt: str) -> str | None:
    """
    Converte várias entradas para ISO (AAAA-MM-DD).
    Aceita:
      - YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY/MM/DD, YYYY.MM.DD
      - 'hoje', 'amanha'/'amanhã'
      - 8 dígitos: DDMMYYYY ou YYYYMMDD
    """
    if not txt:
        return None
    raw = txt.strip().lower()

    if raw in ("hoje",):
        return datetime.today().strftime("%Y-%m-%d")
    if raw in ("amanha", "amanhã"):
        return (datetime.today() + timedelta(days=1)).strftime("%Y-%m-%d")

    if raw.isdigit() and len(raw) == 8:
        for fmt in ("%d%m%Y", "%Y%m%d"):
            try:
                return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
            except ValueError:
                pass
        return None

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None

def data_eh_passada(data_iso: str) -> bool:
    """True se data for anterior a hoje."""
    try:
        d = datetime.strptime(data_iso, "%Y-%m-%d").date()
        return d < datetime.today().date()
    except Exception:
        return True

def conectar():
    return sqlite3.connect("barbearia.db")

# --------- Setup ---------
def criar_tabelas():
    conn = conectar()
    cursor = conn.cursor()

    # Agendamentos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_cliente TEXT NOT NULL,
        telefone TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'agendado',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(data)")
    cursor.execute("""
    CREATE UNIQUE INDEX IF NOT EXISTS ux_ag_data_fone_agendado
           ON agendamentos(data, telefone)
        WHERE status = 'agendado'
    """)

    # Bloqueios de data (um por dia)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bloqueios (
        dia TEXT PRIMARY KEY,
        motivo TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_blk_dia ON bloqueios(dia)")

    conn.commit()
    conn.close()

# --------- Bloqueios helpers ---------
def data_bloqueada(data_iso: str) -> tuple[bool, str | None]:
    """Retorna (True, motivo) se a data estiver bloqueada, senão (False, None)."""
    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("SELECT motivo FROM bloqueios WHERE dia = ?", (data_iso,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return True, row[0] or ""
    return False, None

# --------- Casos de uso: Agendamentos ---------
def inserir_agendamento():
    nome = input("Nome completo do cliente: ").strip()
    telefone = input("Telefone (somente números): ").strip()
    data_txt = input("Data (ex.: 2025-08-15, 15/08/2025, hoje, amanha, 15082025): ").strip()

    data_iso = normalizar_data(data_txt)
    if not data_iso:
        print(f"❌ Data inválida: '{data_txt}'.\n")
        return

    if data_eh_passada(data_iso):
        print(f"⛔ Não é permitido agendar em data passada ({data_iso}).\n")
        return

    bloqueada, motivo = data_bloqueada(data_iso)
    if bloqueada:
        print(f"⛔ Data {data_iso} está BLOQUEADA. Motivo: {motivo or 'sem motivo informado'}.\n")
        return

    telefone_formatado = formatar_telefone(telefone)

    conn = conectar()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO agendamentos (nome_cliente, telefone, data)
        VALUES (?, ?, ?)
        """, (nome, telefone_formatado, data_iso))
        conn.commit()
        print("✅ Agendamento inserido com sucesso!\n")
    except sqlite3.IntegrityError:
        print("⚠️ Já existe um agendamento 'agendado' para esse telefone nessa data.")
        print("   Cancele o existente ou escolha outra data.\n")
    finally:
        conn.close()

def listar_agendamentos(filtro_status: str | None = None):
    conn = conectar()
    cursor = conn.cursor()

    if filtro_status:
        cursor.execute(
            "SELECT * FROM agendamentos WHERE status = ? ORDER BY date(data) ASC, id ASC",
            (filtro_status,),
        )
    else:
        cursor.execute("SELECT * FROM agendamentos ORDER BY date(data) ASC, id ASC")

    agendamentos = cursor.fetchall()
    conn.close()

    if not agendamentos:
        print("❌ Nenhum agendamento encontrado.\n")
        return []

    print("📅 Lista de Agendamentos:\n")
    for agendamento in agendamentos:
        id_, nome, telefone, data, status, criado_em = agendamento
        print(f"ID: {id_}")
        print(f"Cliente: {nome}")
        print(f"Telefone: {telefone}")
        print(f"Data: {data}")
        print(f"Status: {status}")
        print(f"Criado em: {criado_em}")
        print("-" * 30)

    return agendamentos

def listar_por_data():
    data_txt = input("Data para buscar (AAAA-MM-DD, DD/MM/AAAA, hoje, amanha): ").strip()
    data_iso = normalizar_data(data_txt)
    if not data_iso:
        print(f"❌ Data inválida: '{data_txt}'.\n")
        return

    bloqueada, motivo = data_bloqueada(data_iso)
    if bloqueada:
        print(f"🚫 ATENÇÃO: {data_iso} está BLOQUEADA. Motivo: {motivo or 'sem motivo informado'}")

    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM agendamentos
         WHERE data = ?
         ORDER BY
            CASE status
                WHEN 'agendado' THEN 1
                WHEN 'finalizado' THEN 2
                WHEN 'cancelado' THEN 3
                ELSE 4
            END, id
    """, (data_iso,))
    rows = cursor.fetchall()

    cursor.execute("SELECT COUNT(*) FROM agendamentos WHERE data = ?", (data_iso,))
    total = cursor.fetchone()[0]
    conn.close()

    print(f"\n📆 Agendamentos em {data_iso} — Total: {total}\n")
    if not rows:
        print("⛔ Nenhum agendamento nessa data.\n")
        return

    for id_, nome, telefone, data, status, criado_em in rows:
        print(f"ID: {id_}")
        print(f"Cliente: {nome}")
        print(f"Telefone: {telefone}")
        print(f"Status: {status}")
        print(f"Criado em: {criado_em}")
        print("-" * 30)

def listar_hoje():
    data_iso = datetime.today().strftime("%Y-%m-%d")
    bloqueada, motivo = data_bloqueada(data_iso)
    if bloqueada:
        print(f"🚫 ATENÇÃO: Hoje ({data_iso}) está BLOQUEADA. Motivo: {motivo or 'sem motivo informado'}")

    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM agendamentos
         WHERE data = ?
         ORDER BY
            CASE status
                WHEN 'agendado' THEN 1
                WHEN 'finalizado' THEN 2
                WHEN 'cancelado' THEN 3
                ELSE 4
            END, id
    """, (data_iso,))
    rows = cursor.fetchall()

    cursor.execute("SELECT COUNT(*) FROM agendamentos WHERE data = ?", (data_iso,))
    total = cursor.fetchone()[0]
    conn.close()

    print(f"\n📆 Hoje ({data_iso}) — Total: {total}\n")
    if not rows:
        print("⛔ Nenhum agendamento hoje.\n")
        return

    for id_, nome, telefone, data, status, criado_em in rows:
        print(f"ID: {id_}")
        print(f"Cliente: {nome}")
        print(f"Telefone: {telefone}")
        print(f"Status: {status}")
        print(f"Criado em: {criado_em}")
        print("-" * 30)

def cancelar_agendamento():
    print("\n🔎 Mostrando apenas 'agendado' para cancelar:\n")
    agendados = listar_agendamentos(filtro_status="agendado")
    if not agendados:
        return

    try:
        id_cancelar = int(input("ID para cancelar: ").strip())
    except ValueError:
        print("❌ ID inválido.\n")
        return

    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM agendamentos WHERE id = ?", (id_cancelar,))
    row = cursor.fetchone()

    if not row:
        print("⚠️ ID não encontrado.\n")
    elif row[0] != "agendado":
        print("⚠️ Só é possível cancelar itens com status 'agendado'.\n")
    else:
        cursor.execute("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?", (id_cancelar,))
        conn.commit()
        print("❌ Agendamento cancelado com sucesso!\n")

    conn.close()

def finalizar_agendamento():
    print("\n🔎 Mostrando apenas 'agendado' para finalizar:\n")
    agendados = listar_agendamentos(filtro_status="agendado")
    if not agendados:
        return

    try:
        id_finalizar = int(input("ID para finalizar: ").strip())
    except ValueError:
        print("❌ ID inválido.\n")
        return

    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM agendamentos WHERE id = ?", (id_finalizar,))
    row = cursor.fetchone()

    if not row:
        print("⚠️ ID não encontrado.\n")
    elif row[0] != "agendado":
        print("⚠️ Só é possível finalizar itens com status 'agendado'.\n")
    else:
        cursor.execute("UPDATE agendamentos SET status = 'finalizado' WHERE id = ?", (id_finalizar,))
        conn.commit()
        print("✅ Agendamento finalizado com sucesso!\n")

    conn.close()

def editar_agendamento():
    print("\n✏️ Editar agendamento (nome, telefone e/ou data)")
    listar_agendamentos()
    try:
        id_editar = int(input("ID para editar: ").strip())
    except ValueError:
        print("❌ ID inválido.\n")
        return

    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nome_cliente, telefone, data, status FROM agendamentos WHERE id = ?", (id_editar,))
    row = cursor.fetchone()

    if not row:
        print("⚠️ ID não encontrado.\n")
        conn.close()
        return

    id_, nome_atual, fone_atual, data_atual, status_atual = row
    print("\nValores atuais (deixe em branco para manter):")
    print(f"Nome atual: {nome_atual}")
    print(f"Telefone atual: {fone_atual}")
    print(f"Data atual: {data_atual}")
    print(f"Status atual: {status_atual} (não editável aqui)")

    novo_nome = input("Novo nome: ").strip()
    novo_fone = input("Novo telefone (somente números): ").strip()
    nova_data = input("Nova data (AAAA-MM-DD, DD/MM/AAAA, hoje, amanha) [enter p/ manter]: ").strip()

    if novo_nome == "":
        novo_nome = nome_atual

    if novo_fone == "":
        fone_formatado = fone_atual
    else:
        fone_formatado = formatar_telefone(novo_fone)

    if nova_data == "":
        nova_data_iso = data_atual
    else:
        nova_data_iso = normalizar_data(nova_data)
        if not nova_data_iso:
            print(f"❌ Data inválida: '{nova_data}'. Alteração cancelada.\n")
            conn.close()
            return
        if data_eh_passada(nova_data_iso):
            print(f"⛔ Não é permitido alterar para data passada ({nova_data_iso}).\n")
            conn.close()
            return
        bloqueada, motivo = data_bloqueada(nova_data_iso)
        if bloqueada:
            print(f"⛔ Não é permitido alterar para data BLOQUEADA ({nova_data_iso}). Motivo: {motivo or 'sem motivo'}.\n")
            conn.close()
            return

    try:
        cursor.execute("""
            UPDATE agendamentos
               SET nome_cliente = ?, telefone = ?, data = ?
             WHERE id = ?
        """, (novo_nome, fone_formatado, nova_data_iso, id_))
        conn.commit()
        print("🛠️ Agendamento atualizado com sucesso!\n")
    except sqlite3.IntegrityError:
        print("⚠️ Já existe um agendamento 'agendado' para esse telefone nessa data.")
        print("   Cancele o existente ou escolha outra data.\n")
    finally:
        conn.close()

# --------- Casos de uso: Bloqueios ---------
def listar_bloqueios():
    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT dia, motivo, criado_em
          FROM bloqueios
         ORDER BY date(dia) ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    print("\n🚫 Datas bloqueadas:\n")
    if not rows:
        print("Nenhuma data bloqueada.\n")
        return

    for dia, motivo, criado_em in rows:
        print(f"Dia: {dia} | Motivo: {motivo or '—'} | Criado em: {criado_em}")
    print("-" * 30)

def bloquear_data():
    data_txt = input("Dia para bloquear (AAAA-MM-DD, DD/MM/AAAA, hoje, amanha): ").strip()
    data_iso = normalizar_data(data_txt)
    if not data_iso:
        print(f"❌ Data inválida: '{data_txt}'.\n")
        return
    motivo = input("Motivo do bloqueio (opcional): ").strip()

    conn = conectar()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO bloqueios (dia, motivo) VALUES (?, ?)", (data_iso, motivo or None))
        conn.commit()
        print(f"✅ Dia {data_iso} bloqueado com sucesso!\n")
    except sqlite3.IntegrityError:
        print("⚠️ Essa data já está bloqueada.\n")
    finally:
        conn.close()

def desbloquear_data():
    data_txt = input("Dia para desbloquear (AAAA-MM-DD, DD/MM/AAAA, hoje, amanha): ").strip()
    data_iso = normalizar_data(data_txt)
    if not data_iso:
        print(f"❌ Data inválida: '{data_txt}'.\n")
        return

    conn = conectar()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM bloqueios WHERE dia = ?", (data_iso,))
    if cursor.rowcount > 0:
        conn.commit()
        print(f"✅ Dia {data_iso} desbloqueado!\n")
    else:
        print("ℹ️ Essa data não estava bloqueada.\n")
    conn.close()

# --------- UI (menu) ---------
def menu():
    criar_tabelas()
    while True:
        print("\n=== Barbearia Teodoro's ===")
        print("1. Inserir novo agendamento")
        print("2. Listar agendamentos")
        print("3. Finalizar agendamento")
        print("4. Cancelar agendamento")
        print("5. Editar agendamento")
        print("6. Buscar por data")
        print("7. Listar somente hoje")
        print("8. Listar bloqueios")
        print("9. Bloquear data")
        print("10. Desbloquear data")
        print("11. Sair")
        opcao = input("Escolha uma opção: ").strip()

        if opcao == "1":
            inserir_agendamento()
        elif opcao == "2":
            listar_agendamentos()
        elif opcao == "3":
            finalizar_agendamento()
        elif opcao == "4":
            cancelar_agendamento()
        elif opcao == "5":
            editar_agendamento()
        elif opcao == "6":
            listar_por_data()
        elif opcao == "7":
            listar_hoje()
        elif opcao == "8":
            listar_bloqueios()
        elif opcao == "9":
            bloquear_data()
        elif opcao == "10":
            desbloquear_data()
        elif opcao == "11":
            print("Saindo... Até logo! ✂️")
            break
        else:
            print("Opção inválida. Tente novamente.")

if __name__ == "__main__":
    menu()
