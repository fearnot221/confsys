// Seeds the local demo stack (deploy/demo/compose.yaml) with synthetic data:
// one administrator registered through the real HTTP/mail flow, promoted by the
// documented bootstrap service, and a published bilingual demo website.
// Idempotent: existing account, role and publication are detected and kept.
// Never logs passwords or tokens.
import { randomUUID } from "node:crypto";
import http from "node:http";
import { createPool } from "@confsys/db";
import {
  initialSite,
  siteLocales,
  type SiteDocument,
} from "@confsys/contracts";
import { bootstrapAdministrator } from "../apps/api/src/access/bootstrap.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment: ${name}`);
  return value;
}
const api = required("DEMO_API_URL");
const mailpit = required("DEMO_MAILPIT_URL");
const origin = required("PUBLIC_APP_ORIGIN");
const email = required("DEMO_ADMIN_EMAIL");
const password = required("DEMO_ADMIN_PASSWORD");
const conferenceName = required("CONFERENCE_NAME");

const log = (event: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ service: "demo-seed", event, ...extra }));

// Minimal cookie jar: the API authenticates with HttpOnly session + CSRF cookies.
const jar = new Map<string, string>();
// node:http instead of fetch: the API only accepts the canonical Host header,
// which fetch does not allow callers to set.
function call(
  path: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return new Promise<Response>((resolve, reject) => {
    const request = http.request(
      new URL(path, api),
      {
        method: init.method ?? "GET",
        headers: {
          accept: "application/json",
          host: new URL(origin).host,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...init.headers,
        },
      },
      (response) => {
        for (const line of response.headers["set-cookie"] ?? []) {
          const [pair] = line.split(";");
          const index = pair!.indexOf("=");
          jar.set(pair!.slice(0, index).trim(), pair!.slice(index + 1));
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks).toString("utf8"), {
              status: response.statusCode ?? 502,
            }),
          ),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(init.body);
  });
}
async function post(path: string, body: unknown) {
  const { csrfToken } = (await (await call("/api/auth/csrf")).json()) as {
    csrfToken: string;
  };
  return call(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      "x-csrf-token": csrfToken,
    },
  });
}
async function expectOk(response: Response, step: string) {
  if (!response.ok)
    throw new Error(
      `${step} failed with HTTP ${response.status}: ${await response.text()}`,
    );
  return response.json();
}
type Account = { user: { id: string; roles: string[] } };
async function login(): Promise<Account | null> {
  const response = await post("/api/auth/login", { email, password });
  return response.ok ? ((await response.json()) as Account) : null;
}

async function verificationToken() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const search = (await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((r) => r.json())) as { messages: { ID: string; Subject: string }[] };
    const id = search.messages.find((m) =>
      m.Subject.includes("Verify email"),
    )?.ID;
    if (id) {
      const message = (await fetch(`${mailpit}/api/v1/message/${id}`).then(
        (r) => r.json(),
      )) as { Text: string };
      const token = /\/auth\/verify#token=([A-Za-z0-9_-]{43})/.exec(
        message.Text,
      )?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Verification mail was not captured by Mailpit");
}

function demoSite(): SiteDocument {
  const d = initialSite(conferenceName);
  Object.assign(d, {
    startDate: "2027-02-26",
    endDate: "2027-02-28",
    timezone: "Asia/Taipei",
    contactEmail: "forum@demo.invalid",
    phone: "+886 2 0000 0000",
    enabledLocales: [...siteLocales],
  });
  const page = (
    title: string,
    description: string,
    body: string,
    bullets: string[] = [],
    links: { label: string; url: string }[] = [],
  ) => ({ title, description, body, bullets, links });
  const zh = d.translations["zh-Hant"];
  const en = d.translations.en;
  Object.assign(zh, {
    name: conferenceName,
    subtitle: "資料、語言與社會的交會",
    summary:
      "三天議程匯集各地研究者，聚焦語言模型、數位人文與計算社會科學。（合成示範資料）",
    venue: "示範大學 博雅教學館",
    address: "臺北市示範路一段一號（合成地址）",
    organizers: "合成計算語言學會\n示範大學 語言學研究所",
    hosts: "示範資料科學中心",
    contactNote: "示範：由捷運站步行約 8 分鐘。",
  });
  Object.assign(en, {
    name: "Taiwan Computational Linguistics & Society Forum 2027",
    subtitle: "Where data, language and society meet",
    summary:
      "Three days of research on language models, digital humanities and computational social science. (Synthetic demo data)",
    venue: "Demo University, Boya Hall",
    address: "No. 1, Demo Rd., Taipei (synthetic)",
    organizers: "Synthetic Computational Linguistics Society",
    hosts: "Demo Data Science Center",
    contactNote: "Demo: eight minutes on foot from the MRT.",
  });
  zh.pages.home = page(
    "首頁",
    "研討會首頁",
    "歡迎各界研究者投稿與參與，徵稿主題涵蓋理論、方法與應用。",
    [],
    [
      { label: "前往報名", url: "/registration" },
      { label: "投稿系統", url: "/submissions" },
      { label: "公開議程", url: "/program" },
    ],
  );
  zh.pages.about = page(
    "關於會議",
    "會議簡介",
    "本研討會自 2012 年起每年舉辦（合成示範內容）。",
    ["主題演講 4 場", "論文發表 120 篇", "工作坊 6 場"],
  );
  zh.pages.participation = page(
    "參與說明",
    "如何參與",
    "所有報名、繳費與投稿皆於線上完成。",
    ["線上完成報名與繳費", "投稿截止後兩週公布結果", "報到時出示電子名牌"],
  );
  zh.pages.contact = page("交通與聯絡", "交通資訊", "");
  en.pages.home = page(
    "Home",
    "Conference home",
    "We welcome submissions on theory, methods and applications.",
    [],
    [
      { label: "Register", url: "/registration" },
      { label: "Submit a paper", url: "/submissions" },
      { label: "Programme", url: "/program" },
    ],
  );
  en.pages.about = page(
    "About",
    "About the forum",
    "Held annually since 2012 (synthetic demo content).",
    ["4 keynotes", "120 papers", "6 workshops"],
  );
  en.pages.participation = page(
    "Participation",
    "How to take part",
    "Registration, payment and submission all happen online.",
    [
      "Register and pay online",
      "Results two weeks after the deadline",
      "Show your digital badge at check-in",
    ],
  );
  en.pages.contact = page("Travel & contact", "Getting here", "");
  return d;
}

let account = await login();
if (!account) {
  log("register_admin", { email });
  await expectOk(await post("/api/auth/register", { email }), "register");
  await expectOk(
    await post("/api/auth/verify", {
      token: await verificationToken(),
      password,
    }),
    "verify",
  );
  account = await login();
  if (!account) throw new Error("Login failed after verification");
}

if (!account.user.roles.includes("conference_admin")) {
  log("bootstrap_admin", { userId: account.user.id });
  const pool = createPool(required("MIGRATION_DATABASE_URL"));
  try {
    await bootstrapAdministrator(
      pool,
      { conferenceName, origin },
      {
        targetId: account.user.id,
        apply: true,
        reason: "local synthetic demo seed",
        confirmOrigin: origin,
      },
      randomUUID(),
    );
  } finally {
    await pool.end();
  }
  jar.clear();
  account = await login();
  if (!account) throw new Error("Login failed after bootstrap");
}

const published = (await expectOk(await call("/api/site"), "public site")) as {
  publicationId: string | null;
};
if (published.publicationId) {
  log("site_already_published");
} else {
  await expectOk(
    await post("/api/auth/reauthenticate", { password }),
    "reauthenticate",
  );
  const draft = (await expectOk(await call("/api/site/draft"), "draft")) as {
    draftVersion: number;
  };
  const saved = (await expectOk(
    await post("/api/site/draft", {
      expectedVersion: draft.draftVersion,
      document: demoSite(),
    }),
    "save draft",
  )) as { draftVersion: number };
  await expectOk(
    await post("/api/site/publish", { expectedVersion: saved.draftVersion }),
    "publish",
  );
  log("site_published");
}
log("done", { email, origin });
