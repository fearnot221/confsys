import { useState } from "react";
import type { ProgramDraft, PublicProgram } from "@confsys/contracts";
type Room = ProgramDraft["rooms"][number];
type Session = ProgramDraft["sessions"][number];
type Block = ProgramDraft["blocked"][number];
type Slot = {
  id: string;
  sessionId: string;
  kind: "oral" | "poster" | "invited";
  revisionId: string | null;
  startsAt: string;
  endsAt: string;
  posterNumber: number | null;
  invitedTitle: string;
  invitedSpeaker: string;
  invitedAffiliation: string;
  invitedEmail: string;
};
type Props = {
  draft: ProgramDraft | null;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  canPublish: boolean;
  newId: () => string;
  onRetry: () => void;
  onRoom: (v: Room) => void;
  onBlocked: (v: Block) => void;
  onSession: (v: Session) => void;
  onSlot: (v: Slot) => void;
  onRemove: (kind: "room" | "blocked" | "session" | "slot", id: string) => void;
  onPublish: () => void;
  onReauthenticate: (password: string) => void;
};
export function ProgramScreen(p: Props) {
  const [room, setRoom] = useState<Room | null>(null),
    [block, setBlock] = useState<Block | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [slot, setSlot] = useState<Slot | null>(null),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(false);
  const d = p.draft;
  const timeFields = (
    value: { startsAt: string; endsAt: string },
    change: (patch: { startsAt?: string; endsAt?: string }) => void,
  ) => (
    <>
      <label>
        開始 UTC ISO
        <input
          placeholder="2026-10-15T01:00:00Z"
          value={value.startsAt}
          onChange={(e) => change({ startsAt: e.target.value })}
        />
      </label>
      <label>
        結束 UTC ISO
        <input
          placeholder="2026-10-15T02:00:00Z"
          value={value.endsAt}
          onChange={(e) => change({ endsAt: e.target.value })}
        />
      </label>
    </>
  );
  return (
    <main className="layout">
      <header>
        <a href="/auth/account">我的帳號</a> · <a href="/program">公開議程</a>
        <h1>議程管理</h1>
        <p>
          稿件必須已有對應提交版本的正式錄取結果。會場、主持人與報告者衝突由伺服器判定。
        </p>
      </header>
      {p.loading && <p role="status">載入中…</p>}
      {p.error && (
        <div role="alert">
          <p>{p.error}</p>
          <button onClick={p.onRetry}>重新載入</button>
        </div>
      )}
      {p.message && <p role="status">{p.message}</p>}
      {d && (
        <>
          <p>
            草稿版本 {d.version} · 目前發布：
            {d.activePublicationId ?? "尚未發布"}
          </p>
          <fieldset disabled={p.busy}>
            <legend>會場與緩衝</legend>
            <button
              onClick={() =>
                setRoom({
                  id: p.newId(),
                  name: "",
                  venue: "",
                  bufferMinutes: 0,
                })
              }
            >
              新增會場
            </button>
            <ul>
              {d.rooms.map((r) => (
                <li key={r.id}>
                  {r.venue} / {r.name} · 緩衝 {r.bufferMinutes} 分鐘{" "}
                  <button onClick={() => setRoom(r)}>編輯會場</button>
                  <button onClick={() => p.onRemove("room", r.id)}>
                    刪除未使用會場
                  </button>
                </li>
              ))}
            </ul>
            {room && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onRoom(room);
                }}
              >
                <label>
                  場館
                  <input
                    required
                    value={room.venue}
                    onChange={(e) =>
                      setRoom({ ...room, venue: e.target.value })
                    }
                  />
                </label>
                <label>
                  會場名稱
                  <input
                    required
                    value={room.name}
                    onChange={(e) => setRoom({ ...room, name: e.target.value })}
                  />
                </label>
                <label>
                  前後緩衝分鐘
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={room.bufferMinutes}
                    onChange={(e) =>
                      setRoom({
                        ...room,
                        bufferMinutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <button>儲存會場</button>
              </form>
            )}
          </fieldset>
          <fieldset disabled={p.busy}>
            <legend>不可排時段</legend>
            <button
              onClick={() =>
                setBlock({
                  id: p.newId(),
                  roomId: d.rooms[0]?.id ?? "",
                  startsAt: "",
                  endsAt: "",
                  reason: "",
                })
              }
            >
              新增不可排時段
            </button>
            <ul>
              {d.blocked.map((b) => (
                <li key={b.id}>
                  {d.rooms.find((r) => r.id === b.roomId)?.name} · {b.startsAt}{" "}
                  – {b.endsAt} · {b.reason}
                  <button onClick={() => setBlock(b)}>編輯不可排時段</button>
                  <button onClick={() => p.onRemove("blocked", b.id)}>
                    刪除不可排時段
                  </button>
                </li>
              ))}
            </ul>
            {block && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onBlocked(block);
                }}
              >
                <label>
                  不可排會場
                  <select
                    value={block.roomId}
                    onChange={(e) =>
                      setBlock({ ...block, roomId: e.target.value })
                    }
                  >
                    {d.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                {timeFields(block, (v) => setBlock({ ...block, ...v }))}
                <label>
                  不可排原因
                  <input
                    required
                    value={block.reason}
                    onChange={(e) =>
                      setBlock({ ...block, reason: e.target.value })
                    }
                  />
                </label>
                <button>儲存不可排時段</button>
              </form>
            )}
          </fieldset>
          <fieldset disabled={p.busy}>
            <legend>Session 與主持人</legend>
            <button
              onClick={() =>
                setSession({
                  id: p.newId(),
                  roomId: d.rooms[0]?.id ?? "",
                  title: "",
                  startsAt: "",
                  endsAt: "",
                  chairName: "",
                  chairEmail: "",
                })
              }
            >
              新增 Session
            </button>
            <ul>
              {d.sessions.map((s) => (
                <li key={s.id}>
                  {s.title} · {s.startsAt} – {s.endsAt} · {s.chairName}
                  <button onClick={() => setSession(s)}>編輯 Session</button>
                  <button onClick={() => p.onRemove("session", s.id)}>
                    刪除空 Session
                  </button>
                </li>
              ))}
            </ul>
            {session && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onSession(session);
                }}
              >
                <label>
                  Session 名稱
                  <input
                    required
                    value={session.title}
                    onChange={(e) =>
                      setSession({ ...session, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  Session 會場
                  <select
                    value={session.roomId}
                    onChange={(e) =>
                      setSession({ ...session, roomId: e.target.value })
                    }
                  >
                    {d.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                {timeFields(session, (v) => setSession({ ...session, ...v }))}
                <label>
                  主持人姓名
                  <input
                    required
                    value={session.chairName}
                    onChange={(e) =>
                      setSession({ ...session, chairName: e.target.value })
                    }
                  />
                </label>
                <label>
                  主持人 Email（僅供私有衝突檢查）
                  <input
                    type="email"
                    required
                    value={session.chairEmail}
                    onChange={(e) =>
                      setSession({ ...session, chairEmail: e.target.value })
                    }
                  />
                </label>
                <button>儲存 Session</button>
              </form>
            )}
          </fieldset>
          <fieldset disabled={p.busy}>
            <legend>發表時段</legend>
            <button
              onClick={() =>
                setSlot({
                  id: p.newId(),
                  sessionId: d.sessions[0]?.id ?? "",
                  kind: "oral",
                  revisionId: null,
                  startsAt: "",
                  endsAt: "",
                  posterNumber: null,
                  invitedTitle: "",
                  invitedSpeaker: "",
                  invitedAffiliation: "",
                  invitedEmail: "",
                })
              }
            >
              新增發表
            </button>
            <ul>
              {d.slots.map((s) => (
                <li key={s.id}>
                  {s.title} · {s.presenterName} · {s.startsAt} – {s.endsAt} ·{" "}
                  {s.kind}
                  {s.posterNumber ? ` #${s.posterNumber}` : ""}
                  <button
                    onClick={() =>
                      setSlot({
                        id: s.id,
                        sessionId: s.sessionId,
                        kind: s.kind,
                        revisionId: s.revisionId,
                        startsAt: s.startsAt,
                        endsAt: s.endsAt,
                        posterNumber: s.posterNumber,
                        invitedTitle: s.invitedTitle,
                        invitedSpeaker: s.invitedSpeaker,
                        invitedAffiliation: s.invitedAffiliation,
                        invitedEmail: s.invitedEmail,
                      })
                    }
                  >
                    編輯發表
                  </button>
                  <button onClick={() => p.onRemove("slot", s.id)}>
                    移除發表
                  </button>
                </li>
              ))}
            </ul>
            {slot && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  p.onSlot(slot);
                }}
              >
                <label>
                  所屬 Session
                  <select
                    value={slot.sessionId}
                    onChange={(e) =>
                      setSlot({ ...slot, sessionId: e.target.value })
                    }
                  >
                    {d.sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  發表類型
                  <select
                    value={slot.kind}
                    onChange={(e) =>
                      setSlot({
                        ...slot,
                        kind: e.target.value as Slot["kind"],
                        posterNumber: e.target.value === "poster" ? 1 : null,
                        revisionId:
                          e.target.value === "invited" ? null : slot.revisionId,
                      })
                    }
                  >
                    <option value="oral">口頭</option>
                    <option value="poster">壁報</option>
                    <option value="invited">邀請演講</option>
                  </select>
                </label>
                {timeFields(slot, (v) => setSlot({ ...slot, ...v }))}
                {slot.kind === "invited" ? (
                  <>
                    <label>
                      演講題目
                      <input
                        required
                        value={slot.invitedTitle}
                        onChange={(e) =>
                          setSlot({ ...slot, invitedTitle: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      邀請講者姓名
                      <input
                        required
                        value={slot.invitedSpeaker}
                        onChange={(e) =>
                          setSlot({ ...slot, invitedSpeaker: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      邀請講者單位
                      <input
                        value={slot.invitedAffiliation}
                        onChange={(e) =>
                          setSlot({
                            ...slot,
                            invitedAffiliation: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      邀請講者 Email（私有）
                      <input
                        required
                        type="email"
                        value={slot.invitedEmail}
                        onChange={(e) =>
                          setSlot({ ...slot, invitedEmail: e.target.value })
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    正式錄取的提交版本 ID
                    <input
                      required
                      value={slot.revisionId ?? ""}
                      onChange={(e) =>
                        setSlot({ ...slot, revisionId: e.target.value || null })
                      }
                    />
                  </label>
                )}
                {slot.kind === "poster" && (
                  <label>
                    壁報編號
                    <input
                      required
                      type="number"
                      min={1}
                      value={slot.posterNumber ?? ""}
                      onChange={(e) =>
                        setSlot({
                          ...slot,
                          posterNumber: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
                <button>儲存發表</button>
              </form>
            )}
          </fieldset>
          {p.canPublish && (
            <section>
              <h2>正式發布</h2>
              <p>
                發布僅含題目、發表者姓名與單位、會場、時段、主持人及壁報編號；不包含
                Email、摘要或私人審查內容。
              </p>
              <label>
                重新驗證密碼
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                disabled={p.busy}
                onClick={() => {
                  p.onReauthenticate(password);
                  setPassword("");
                }}
              >
                重新驗證
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                確認發布目前完整議程草稿
              </label>
              <button
                disabled={!confirm || p.busy}
                onClick={() => {
                  p.onPublish();
                  setConfirm(false);
                }}
              >
                發布議程
              </button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
export function PublicProgramContent({ program }: { program: PublicProgram }) {
  const [search, setSearch] = useState("");
  return (
    <main className="layout">
      <a href="/">研討會首頁</a>
      <h1>研討會議程</h1>
      {!program.publicationId ? (
        <p>議程尚未發布。</p>
      ) : (
        <>
          <p>發布時間：{program.publishedAt}</p>
          <label>
            搜尋題目或發表者
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {program.sessions.map((s) => {
            const slots = s.slots.filter((v) =>
              `${v.title} ${v.presenterName}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            );
            if (search && !slots.length) return null;
            return (
              <section key={s.id}>
                <h2>{s.title}</h2>
                <p>
                  {s.venue} / {s.roomName} · {s.startsAt} – {s.endsAt}
                </p>
                <p>主持人：{s.chairName}</p>
                <ol>
                  {slots.map((v) => (
                    <li key={v.id}>
                      <strong>{v.title}</strong>
                      <p>
                        {v.presenterName} · {v.presenterAffiliation}
                      </p>
                      <p>
                        {v.startsAt} – {v.endsAt} ·{" "}
                        {v.kind === "oral"
                          ? "口頭"
                          : v.kind === "poster"
                            ? `壁報 ${v.posterNumber}`
                            : "邀請演講"}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
export function PublicProgramScreen(p: {
  program: PublicProgram | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return p.program ? (
    <PublicProgramContent program={p.program} />
  ) : (
    <main className="layout">
      {p.loading ? (
        <p role="status">載入議程…</p>
      ) : (
        <div role="alert">
          <p>{p.error}</p>
          <button onClick={p.onRetry}>重試</button>
        </div>
      )}
    </main>
  );
}
