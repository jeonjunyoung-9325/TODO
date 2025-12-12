"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Calendar,
  Tag,
  Flag,
  Search,
  X,
  LogOut,
  Trophy,
  Sparkles,
  Gift,
  Dice6,
  Clock3,
  Settings,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/**
 * TODO RPG (Minimal + Game)
 * - Priority dropdown: [상/중/하] => auto XP
 * - Due date + Tags + Estimate minutes
 * - Motivation: Daily goal, streak, weekly quests, loot box(random bonus)
 * - Cloud sync via Supabase (Email OTP)
 *
 * ✅ 캔버스에서 코드 편집이 어려운 경우를 위해:
 *   앱 안에서 Supabase URL/anon key를 입력하고 저장(로컬에 "키만") →
 *   데이터(투두/설정)는 Supabase DB에 저장되도록 구성했습니다.
 *
 * ⚠️ 절대 넣으면 안 되는 키:
 * - service_role (secret)
 *
 * ✅ 넣어도 되는 키:
 * - anon public key
 */

// =====================
// LocalStorage helpers
// =====================
function safeGet(k) {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}

function safeSet(k, v) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(k, v);
  } catch {
    // ignore
  }
}

function safeDel(k) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(k);
  } catch {
    // ignore
  }
}


const LS_URL_KEY = "https://swyugmwmtzziyeqvpbja.supabase.co";
const LS_ANON_KEY = "sb_publishable_iAyq6icLzY-x3Wzp_ET5Dg_qi_f_rqq";

function buildClientFromStorage() {
  const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const envAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  const url = (envUrl || safeGet(LS_URL_KEY)).trim();
  const anon = (envAnon || safeGet(LS_ANON_KEY)).trim();

  if (!url || !anon) return null;
  try {
    return createClient(url, anon);
  } catch {
    return null;
  }
}
}

// =====================
// Game rules
// =====================
const XP_BY_PRIORITY = {
  HIGH: 40, // 상
  MID: 20, // 중
  LOW: 10, // 하
};

const PRIORITIES = [
  { key: "HIGH", label: "상", weight: 3 },
  { key: "MID", label: "중", weight: 2 },
  { key: "LOW", label: "하", weight: 1 },
];

const DEFAULT_DAILY_GOAL = 60;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function yyyyMmDd(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfLocalWeek(date = new Date()) {
  // Monday start
  const d = startOfLocalDay(date);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function weekKey(date = new Date()) {
  const s = startOfLocalWeek(date);
  return yyyyMmDd(s);
}

function xpNeededForLevel(level) {
  return Math.round(80 + level * 22);
}

function computeLevel(totalXp) {
  let level = 1;
  let xpIntoLevel = totalXp;
  while (xpIntoLevel >= xpNeededForLevel(level)) {
    xpIntoLevel -= xpNeededForLevel(level);
    level += 1;
  }
  const need = xpNeededForLevel(level);
  return { level, xpIntoLevel, need, progress: need === 0 ? 0 : xpIntoLevel / need };
}

function titleByLevel(level) {
  if (level >= 20) return "레전드";
  if (level >= 15) return "마스터";
  if (level >= 10) return "전략가";
  if (level >= 6) return "모험가";
  return "새싹";
}

function parseTags(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function priorityLabel(key) {
  const p = PRIORITIES.find((x) => x.key === key);
  return p ? p.label : "중";
}

function lootRoll() {
  const pool = [
    { label: "빈 상자", bonus: 0, weight: 25 },
    { label: "작은 보석", bonus: 10, weight: 35 },
    { label: "반짝 파편", bonus: 20, weight: 25 },
    { label: "레어 스톤", bonus: 40, weight: 12 },
    { label: "에픽 오브", bonus: 80, weight: 3 },
  ];
  const total = pool.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const it of pool) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return pool[0];
}

function mergeClaimed(oldClaimed, key, payload) {
  const next = { ...(oldClaimed || {}) };
  next[key] = { ...payload, at: new Date().toISOString() };
  return next;
}

function sumBonusForDate(claimed, dateKey) {
  if (!claimed) return 0;
  let sum = 0;
  for (const k of Object.keys(claimed)) {
    const v = claimed[k];
    if (!v?.at) continue;
    if (yyyyMmDd(v.at) === dateKey) sum += Number(v.bonusXp || 0);
  }
  return sum;
}

function sumBonusForWeek(claimed, wk) {
  if (!claimed) return 0;
  let sum = 0;
  for (const k of Object.keys(claimed)) {
    const v = claimed[k];
    if (!v?.at) continue;
    if (weekKey(v.at) === wk) sum += Number(v.bonusXp || 0);
  }
  return sum;
}

// =====================
// App
// =====================

export default function Page() {
  const [sb, setSb] = useState(() => buildClientFromStorage());
  const needsSetup = !sb;

  // Auth
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [authMsg, setAuthMsg] = useState("");

  // Data
  const [todos, setTodos] = useState([]);
  const [settings, setSettings] = useState(null); // { daily_goal_xp, bonus_xp, claimed }
  const [loading, setLoading] = useState(false);

  // Create
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MID");
  const [dueDate, setDueDate] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [estimateMin, setEstimateMin] = useState(30);

  // Filters
  const [q, setQ] = useState("");
  const [filterTag, setFilterTag] = useState("ALL");
  const [filterPriority, setFilterPriority] = useState("ALL");
  const [filterDue, setFilterDue] = useState("ALL"); // ALL | OVERDUE | TODAY | WEEK

  // Toast
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Loot modal
  const [lootOpen, setLootOpen] = useState(false);
  const [loot, setLoot] = useState(null);

  function showToast(payload) {
    setToast(payload);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1800);
  }

  // --- Auth init
  useEffect(() => {
    if (needsSetup) return;

    sb.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null);
    });

    return () => {
      sub?.subscription?.unsubscribe?.();
    };
  }, [needsSetup, sb]);

  // --- Load when logged in
  useEffect(() => {
    if (needsSetup) return;
    if (!session?.user?.id) return;

    (async () => {
      setLoading(true);
      try {
        await ensureSettingsRow(session.user.id);
        await Promise.all([loadSettings(session.user.id), loadTodos(session.user.id)]);
      } finally {
        setLoading(false);
      }
    })();
  }, [needsSetup, session?.user?.id]);

  // =====================
  // Supabase helpers
  // =====================

  async function ensureSettingsRow(userId) {
    const { error } = await sb
      .from("settings")
      .upsert(
        { user_id: userId, daily_goal_xp: DEFAULT_DAILY_GOAL, bonus_xp: 0, claimed: {} },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error(error);
      setAuthMsg("설정 초기화 실패: DB/RLS 설정을 확인해주세요.");
    }
  }

  async function loadSettings(userId) {
    const { data, error } = await sb
      .from("settings")
      .select("daily_goal_xp, bonus_xp, claimed")
      .eq("user_id", userId)
      .single();

    if (error) {
      console.error(error);
      setAuthMsg("설정 로드 실패: DB/RLS 설정을 확인해주세요.");
      return;
    }
    setSettings(data);
  }

  async function loadTodos(userId) {
    const { data, error } = await sb
      .from("todos")
      .select("id, title, done, created_at, done_at, priority, due_date, tags, estimate_minutes")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setAuthMsg("투두 로드 실패: DB/RLS 설정을 확인해주세요.");
      return;
    }

    setTodos(data || []);
  }

  // =====================
  // Auth actions
  // =====================

  async function signInWithEmailOtp() {
    setAuthMsg("");
    const e = email.trim();
    if (!e) return;
    setLoading(true);
    try {
      const { error } = await sb.auth.signInWithOtp({
        email: e,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setAuthMsg(error.message);
      } else {
        setAuthMsg("이메일을 확인해주세요(로그인 링크/OTP). 완료되면 자동 로그인됩니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setLoading(true);
    try {
      await sb.auth.signOut();
      setTodos([]);
      setSettings(null);
      setEmail("");
      setAuthMsg("");
    } finally {
      setLoading(false);
    }
  }

  function openSetup() {
    // 키/클라이언트를 제거해서 Setup 화면으로 복귀
    safeDel(LS_URL_KEY);
    safeDel(LS_ANON_KEY);
    setSb(null);
    setSession(null);
    setTodos([]);
    setSettings(null);
    setEmail("");
    setAuthMsg("");
  }

  // =====================
  // Todo actions
  // =====================

  async function addTodo() {
    const t = title.trim();
    if (!t) return;

    const tags = parseTags(tagsRaw);
    const est = clamp(Number(estimateMin) || 0, 0, 9999);

    const payload = {
      user_id: session.user.id,
      title: t,
      done: false,
      priority,
      due_date: dueDate || null,
      tags,
      estimate_minutes: est || null,
    };

    setLoading(true);
    try {
      const { data, error } = await sb
        .from("todos")
        .insert(payload)
        .select("id, title, done, created_at, done_at, priority, due_date, tags, estimate_minutes")
        .single();

      if (error) {
        console.error(error);
        showToast({ kind: "err", title: "추가 실패", desc: "DB/RLS 설정 확인" });
        return;
      }

      setTodos((prev) => [data, ...prev]);
      setTitle("");
      showToast({ kind: "ok", title: "퀘스트 수락", desc: `${priorityLabel(priority)} · +${XP_BY_PRIORITY[priority]} XP` });
    } finally {
      setLoading(false);
    }
  }

  async function toggleDone(todo) {
    const willBeDone = !todo.done;
    const patch = { done: willBeDone, done_at: willBeDone ? new Date().toISOString() : null };

    // optimistic
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, ...patch } : t)));

    const { error } = await sb.from("todos").update(patch).eq("id", todo.id);

    if (error) {
      console.error(error);
      // rollback
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? todo : t)));
      showToast({ kind: "err", title: "업데이트 실패", desc: "네트워크/권한 확인" });
      return;
    }

    if (willBeDone) {
      const gain = XP_BY_PRIORITY[todo.priority] || 0;
      showToast({ kind: "ok", title: "클리어!", desc: `+${gain} XP` });
    }
  }

  async function removeTodo(todoId) {
    const snapshot = todos;
    setTodos((prev) => prev.filter((t) => t.id !== todoId));
    const { error } = await sb.from("todos").delete().eq("id", todoId);
    if (error) {
      console.error(error);
      setTodos(snapshot);
      showToast({ kind: "err", title: "삭제 실패", desc: "권한/네트워크 확인" });
    }
  }

  async function clearDone() {
    const doneIds = todos.filter((t) => t.done).map((t) => t.id);
    if (doneIds.length === 0) return;

    const snapshot = todos;
    setTodos((prev) => prev.filter((t) => !t.done));

    const { error } = await sb.from("todos").delete().in("id", doneIds);
    if (error) {
      console.error(error);
      setTodos(snapshot);
      showToast({ kind: "err", title: "정리 실패", desc: "권한/네트워크 확인" });
    } else {
      showToast({ kind: "ok", title: "정리 완료", desc: "완료 항목 삭제" });
    }
  }

  async function updateDailyGoal(nextGoal) {
    if (!settings) return;
    const userId = session.user.id;
    const next = clamp(Number(nextGoal) || DEFAULT_DAILY_GOAL, 10, 500);

    setSettings((s) => ({ ...s, daily_goal_xp: next }));
    const { error } = await sb.from("settings").update({ daily_goal_xp: next }).eq("user_id", userId);
    if (error) {
      console.error(error);
      showToast({ kind: "err", title: "저장 실패", desc: "권한/네트워크 확인" });
      await loadSettings(userId);
    }
  }

  async function claimQuest(questId, baseRewardXp, scopeKey) {
    if (!settings) return;

    const claimed = settings.claimed || {};
    const key = scopeKey ? `${questId}:${scopeKey}` : questId;
    if (claimed[key]) return;

    const userId = session.user.id;

    // loot roll (random bonus)
    const loot = lootRoll();
    setLoot(loot);
    setLootOpen(true);

    const bonusXp = loot.bonus;
    const addXp = baseRewardXp + bonusXp;

    const nextBonus = (Number(settings.bonus_xp) || 0) + addXp;
    const nextClaimed = mergeClaimed(claimed, key, { baseRewardXp, bonusXp, label: loot.label });

    // optimistic
    setSettings((s) => ({ ...s, bonus_xp: nextBonus, claimed: nextClaimed }));

    const { error } = await sb
      .from("settings")
      .update({ bonus_xp: nextBonus, claimed: nextClaimed })
      .eq("user_id", userId);

    if (error) {
      console.error(error);
      showToast({ kind: "err", title: "보상 실패", desc: "권한/네트워크 확인" });
      await loadSettings(userId);
      setLootOpen(false);
      return;
    }

    showToast({
      kind: "ok",
      title: "보상 획득",
      desc: `+${baseRewardXp} XP + (랜덤 ${bonusXp} XP)`,
    });
  }

  // =====================
  // Derived stats
  // =====================

  const todayKey = yyyyMmDd(new Date());
  const thisWeekKey = weekKey(new Date());

  const xpFromCompleted = useMemo(() => {
    let sum = 0;
    for (const t of todos) {
      if (!t.done) continue;
      sum += XP_BY_PRIORITY[t.priority] || 0;
    }
    return sum;
  }, [todos]);

  const bonusXp = Number(settings?.bonus_xp) || 0;
  const totalXp = xpFromCompleted + bonusXp;
  const levelState = useMemo(() => computeLevel(totalXp), [totalXp]);

  const doneCount = useMemo(() => todos.filter((t) => t.done).length, [todos]);
  const activeCount = todos.length - doneCount;

  const xpTodayBase = useMemo(() => {
    let sum = 0;
    for (const t of todos) {
      if (!t.done || !t.done_at) continue;
      if (yyyyMmDd(t.done_at) === todayKey) sum += XP_BY_PRIORITY[t.priority] || 0;
    }
    return sum;
  }, [todos, todayKey]);

  const xpTodayBonus = useMemo(() => sumBonusForDate(settings?.claimed, todayKey), [settings?.claimed, todayKey]);
  const xpToday = xpTodayBase + xpTodayBonus;

  const xpWeekBase = useMemo(() => {
    let sum = 0;
    for (const t of todos) {
      if (!t.done || !t.done_at) continue;
      if (weekKey(t.done_at) === thisWeekKey) sum += XP_BY_PRIORITY[t.priority] || 0;
    }
    return sum;
  }, [todos, thisWeekKey]);

  const xpWeekBonus = useMemo(() => sumBonusForWeek(settings?.claimed, thisWeekKey), [settings?.claimed, thisWeekKey]);
  const xpWeek = xpWeekBase + xpWeekBonus;

  const minutesWeek = useMemo(() => {
    let sum = 0;
    for (const t of todos) {
      if (!t.done || !t.done_at) continue;
      if (weekKey(t.done_at) !== thisWeekKey) continue;
      sum += Number(t.estimate_minutes || 0);
    }
    return sum;
  }, [todos, thisWeekKey]);

  const streak = useMemo(() => {
    const completedDays = new Set();
    for (const t of todos) {
      if (t.done && t.done_at) completedDays.add(yyyyMmDd(t.done_at));
    }
    let s = 0;
    let d = startOfLocalDay(new Date());
    while (true) {
      const key = yyyyMmDd(d);
      if (!completedDays.has(key)) break;
      s += 1;
      d.setDate(d.getDate() - 1);
    }
    return s;
  }, [todos]);

  const allTags = useMemo(() => {
    const set = new Set();
    for (const t of todos) {
      for (const tag of t.tags || []) set.add(tag);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [todos]);

  const filteredTodos = useMemo(() => {
    const now = new Date();
    const today = yyyyMmDd(now);

    const isOverdue = (dStr) => {
      if (!dStr) return false;
      const d = new Date(dStr + "T00:00:00");
      return d < startOfLocalDay(now);
    };

    const inNext7Days = (dStr) => {
      if (!dStr) return false;
      const d = new Date(dStr + "T00:00:00");
      const start = startOfLocalDay(now);
      const end = startOfLocalDay(now);
      end.setDate(end.getDate() + 7);
      return d >= start && d <= end;
    };

    const matchQ = (t) => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      const hay = `${t.title} ${(t.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(s);
    };

    const matchTag = (t) => {
      if (filterTag === "ALL") return true;
      return (t.tags || []).includes(filterTag);
    };

    const matchPriority = (t) => {
      if (filterPriority === "ALL") return true;
      return t.priority === filterPriority;
    };

    const matchDue = (t) => {
      if (filterDue === "ALL") return true;
      if (filterDue === "OVERDUE") return !t.done && isOverdue(t.due_date);
      if (filterDue === "TODAY") return !t.done && t.due_date === today;
      if (filterDue === "WEEK") return !t.done && inNext7Days(t.due_date);
      return true;
    };

    const weight = (k) => PRIORITIES.find((p) => p.key === k)?.weight || 2;

    return [...todos]
      .filter(matchQ)
      .filter(matchTag)
      .filter(matchPriority)
      .filter(matchDue)
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const pw = weight(b.priority) - weight(a.priority);
        if (pw !== 0) return pw;
        const ad = a.due_date ? new Date(a.due_date + "T00:00:00").getTime() : Infinity;
        const bd = b.due_date ? new Date(b.due_date + "T00:00:00").getTime() : Infinity;
        if (ad !== bd) return ad - bd;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [todos, q, filterTag, filterPriority, filterDue]);

  const dailyGoal = Number(settings?.daily_goal_xp) || DEFAULT_DAILY_GOAL;
  const dailyProgress = clamp(xpToday / Math.max(1, dailyGoal), 0, 1);

  // Quests: daily + weekly (A안: 실패 페널티 없음)
  const quests = useMemo(() => {
    const claimed = settings?.claimed || {};

    const doneTodayCount = todos.filter((t) => t.done && t.done_at && yyyyMmDd(t.done_at) === todayKey).length;
    const doneTodayHigh = todos.filter(
      (t) => t.done && t.done_at && yyyyMmDd(t.done_at) === todayKey && t.priority === "HIGH"
    ).length;

    const doneWeekCount = todos.filter((t) => t.done && t.done_at && weekKey(t.done_at) === thisWeekKey).length;
    const doneWeekHigh = todos.filter(
      (t) => t.done && t.done_at && weekKey(t.done_at) === thisWeekKey && t.priority === "HIGH"
    ).length;

    const list = [
      // Daily
      {
        id: "daily_3_done",
        title: "오늘 3개",
        reward: 20,
        done: doneTodayCount >= 3,
        claimed: Boolean(claimed[`daily_3_done:${todayKey}`]),
        scopeKey: todayKey,
      },
      {
        id: "daily_1_high",
        title: "오늘 [상] 1개",
        reward: 20,
        done: doneTodayHigh >= 1,
        claimed: Boolean(claimed[`daily_1_high:${todayKey}`]),
        scopeKey: todayKey,
      },

      // Weekly
      {
        id: "weekly_10_done",
        title: "이번 주 10개",
        reward: 60,
        done: doneWeekCount >= 10,
        claimed: Boolean(claimed[`weekly_10_done:${thisWeekKey}`]),
        scopeKey: thisWeekKey,
      },
      {
        id: "weekly_3_high",
        title: "이번 주 [상] 3개",
        reward: 80,
        done: doneWeekHigh >= 3,
        claimed: Boolean(claimed[`weekly_3_high:${thisWeekKey}`]),
        scopeKey: thisWeekKey,
      },
      {
        id: "weekly_300min",
        title: "이번 주 300분",
        reward: 90,
        done: minutesWeek >= 300,
        claimed: Boolean(claimed[`weekly_300min:${thisWeekKey}`]),
        scopeKey: thisWeekKey,
      },

      // Milestones (once)
      {
        id: "streak_7",
        title: "연속 7일",
        reward: 120,
        done: streak >= 7,
        claimed: Boolean(claimed["streak_7"]),
        scopeKey: null,
      },
      {
        id: "total_30",
        title: "누적 30개",
        reward: 150,
        done: doneCount >= 30,
        claimed: Boolean(claimed["total_30"]),
        scopeKey: null,
      },
    ];

    return list;
  }, [todos, todayKey, thisWeekKey, minutesWeek, settings?.claimed, streak, doneCount]);

  const badges = useMemo(() => {
    const b = [];
    if (doneCount >= 1) b.push("첫 클리어");
    if (doneCount >= 10) b.push("클리어 10");
    if (doneCount >= 30) b.push("클리어 30");
    if (streak >= 3) b.push("연속 3일");
    if (streak >= 7) b.push("연속 7일");
    if (xpToday >= dailyGoal) b.push("오늘 목표");
    if (minutesWeek >= 300) b.push("주 300분");
    return b.slice(0, 10);
  }, [doneCount, streak, xpToday, dailyGoal, minutesWeek]);

  // Level up toast
  const [lastLevel, setLastLevel] = useState(null);
  useEffect(() => {
    if (!session) return;
    if (lastLevel === null) {
      setLastLevel(levelState.level);
      return;
    }
    if (levelState.level > lastLevel) {
      showToast({ kind: "ok", title: "레벨 업!", desc: `Lv.${levelState.level} · ${titleByLevel(levelState.level)}` });
      setLastLevel(levelState.level);
    }
  }, [levelState.level, lastLevel, session]);

  // =====================
  // UI
  // =====================

  if (needsSetup) {
    return (
      <Shell>
        <SetupCard
          onSave={(url, anon) => {
            safeSet(LS_URL_KEY, url);
            safeSet(LS_ANON_KEY, anon);
            const next = createClient(url, anon);
            setSb(next);
            showToast({ kind: "ok", title: "연결 저장", desc: "로그인을 진행하세요" });
          }}
        />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <AuthCard email={email} setEmail={setEmail} onLogin={signInWithEmailOtp} msg={authMsg} loading={loading} />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </Shell>
    );
  }

  return (
    <Shell>
      <TopBar
        email={session.user.email}
        loading={loading}
        onSignOut={signOut}
        onOpenSetup={openSetup}
        title={`TODO RPG · ${titleByLevel(levelState.level)}`}
      />

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card>
          <PlayerPanel
            levelState={levelState}
            totalXp={totalXp}
            dailyGoal={dailyGoal}
            xpToday={xpToday}
            dailyProgress={dailyProgress}
            streak={streak}
            weekKeyLabel={thisWeekKey}
            xpWeek={xpWeek}
            minutesWeek={minutesWeek}
            onChangeGoal={updateDailyGoal}
          />
        </Card>

        <Card className="md:col-span-2">
          <CreatePanel
            title={title}
            setTitle={setTitle}
            priority={priority}
            setPriority={setPriority}
            dueDate={dueDate}
            setDueDate={setDueDate}
            tagsRaw={tagsRaw}
            setTagsRaw={setTagsRaw}
            estimateMin={estimateMin}
            setEstimateMin={setEstimateMin}
            onAdd={addTodo}
          />

          <Filters
            q={q}
            setQ={setQ}
            allTags={allTags}
            filterTag={filterTag}
            setFilterTag={setFilterTag}
            filterPriority={filterPriority}
            setFilterPriority={setFilterPriority}
            filterDue={filterDue}
            setFilterDue={setFilterDue}
            activeCount={activeCount}
            doneCount={doneCount}
            onClearDone={clearDone}
          />

          <QuestPanel quests={quests} onClaim={(id, reward, scope) => claimQuest(id, reward, scope)} />

          <BadgePanel badges={badges} />

          <TodoList todos={filteredTodos} onToggle={toggleDone} onRemove={removeTodo} />
        </Card>
      </div>

      <LootModal open={lootOpen} loot={loot} onClose={() => setLootOpen(false)} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </Shell>
  );
}

// =====================
// UI components
// =====================

function Shell({ children }) {
  return (
    <div className="min-h-screen w-full bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}

function TopBar({ title, email, onSignOut, onOpenSetup, loading }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{email}</div>
        <div className="truncate text-lg font-semibold">{title}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          onClick={onOpenSetup}
          disabled={loading}
          title="연결 설정"
        >
          <Settings className="h-4 w-4" />
          설정
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          onClick={onSignOut}
          disabled={loading}
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </button>
      </div>
    </div>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

function Progress({ value }) {
  const pct = clamp(value, 0, 1) * 100;
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
      <motion.div
        className="h-full rounded-full bg-slate-900"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
      />
    </div>
  );
}

function PlayerPanel({
  levelState,
  totalXp,
  dailyGoal,
  xpToday,
  dailyProgress,
  streak,
  weekKeyLabel,
  xpWeek,
  minutesWeek,
  onChangeGoal,
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">플레이어</div>
          <div className="mt-1 text-xl font-semibold">
            Lv.{levelState.level} <span className="text-slate-500">·</span> {titleByLevel(levelState.level)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right">
          <div className="text-[11px] text-slate-500">총 XP</div>
          <div className="text-sm font-semibold tabular-nums">{totalXp}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>다음 레벨</span>
          <span className="tabular-nums">
            {levelState.xpIntoLevel}/{levelState.need}
          </span>
        </div>
        <div className="mt-2">
          <Progress value={levelState.progress} />
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-700">오늘 목표</div>
            <div className="mt-1 text-xs text-slate-500">연속 {streak}일</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="w-20 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              type="number"
              min={10}
              max={500}
              value={dailyGoal}
              onChange={(e) => onChangeGoal(e.target.value)}
            />
            <span className="text-xs text-slate-500">XP</span>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>진행</span>
            <span className="tabular-nums">
              {xpToday}/{dailyGoal}
            </span>
          </div>
          <div className="mt-2">
            <Progress value={dailyProgress} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-medium text-slate-700">이번 주</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <MiniStat label="주간 XP" value={xpWeek} />
          <MiniStat label="주간 분" value={minutesWeek} />
          <MiniStat label="주차" value={weekKeyLabel} />
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500">XP: 상 {XP_BY_PRIORITY.HIGH} / 중 {XP_BY_PRIORITY.MID} / 하 {XP_BY_PRIORITY.LOW}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CreatePanel({
  title,
  setTitle,
  priority,
  setPriority,
  dueDate,
  setDueDate,
  tagsRaw,
  setTagsRaw,
  estimateMin,
  setEstimateMin,
  onAdd,
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">퀘스트 등록</div>
        <div className="text-xs text-slate-500">Enter</div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="할 일"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
        />
        <button
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-sm hover:opacity-90"
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
          추가
        </button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <Field icon={<Flag className="h-4 w-4" />} label="우선">
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} · +{XP_BY_PRIORITY[p.key]} XP
              </option>
            ))}
          </select>
        </Field>

        <Field icon={<Calendar className="h-4 w-4" />} label="마감">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>

        <Field icon={<Tag className="h-4 w-4" />} label="태그">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="예: 업무,운동"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
          />
        </Field>

        <Field icon={<Clock3 className="h-4 w-4" />} label="소요(분)">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            type="number"
            min={0}
            max={9999}
            value={estimateMin}
            onChange={(e) => setEstimateMin(clamp(Number(e.target.value) || 0, 0, 9999))}
          />
        </Field>
      </div>
    </div>
  );
}

function Filters({
  q,
  setQ,
  allTags,
  filterTag,
  setFilterTag,
  filterPriority,
  setFilterPriority,
  filterDue,
  setFilterDue,
  activeCount,
  doneCount,
  onClearDone,
}) {
  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q ? (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-slate-400 hover:bg-slate-50"
              onClick={() => setQ("")}
              aria-label="clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <select
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
        >
          <option value="ALL">태그 전체</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
        >
          <option value="ALL">우선 전체</option>
          {PRIORITIES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>

        <select
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          value={filterDue}
          onChange={(e) => setFilterDue(e.target.value)}
        >
          <option value="ALL">마감 전체</option>
          <option value="OVERDUE">지남</option>
          <option value="TODAY">오늘</option>
          <option value="WEEK">7일</option>
        </select>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          남은 <span className="font-semibold text-slate-900">{activeCount}</span> · 완료{" "}
          <span className="font-semibold text-slate-900">{doneCount}</span>
        </span>
        <button
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
          onClick={onClearDone}
          disabled={doneCount === 0}
        >
          완료 삭제
        </button>
      </div>
    </div>
  );
}

function QuestPanel({ quests, onClaim }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Trophy className="h-4 w-4" />
        퀘스트
        <span className="ml-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">
          보상 → 상자
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {quests.map((q) => (
          <div
            key={q.id + String(q.scopeKey)}
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{q.title}</div>
              <div className="mt-1 text-xs text-slate-500">기본 +{q.reward} XP</div>
            </div>
            <button
              className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold ${
                q.claimed
                  ? "border border-slate-200 bg-white text-slate-400"
                  : q.done
                  ? "bg-slate-900 text-white hover:opacity-90"
                  : "border border-slate-200 bg-white text-slate-400"
              }`}
              disabled={!q.done || q.claimed}
              onClick={() => onClaim(q.id, q.reward, q.scopeKey)}
            >
              <Dice6 className="h-4 w-4" />
              {q.claimed ? "완료" : q.done ? "보상" : "잠김"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs text-slate-500">실패 페널티 없음 · 주간은 월요일 갱신</div>
    </div>
  );
}

function BadgePanel({ badges }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4" />
        배지
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {badges.length === 0 ? (
          <span className="text-xs text-slate-500">아직 없음</span>
        ) : (
          badges.map((b) => (
            <span key={b} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
              {b}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function TodoList({ todos, onToggle, onRemove }) {
  return (
    <div className="mt-4">
      <AnimatePresence initial={false}>
        {todos.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500"
          >
            항목이 없습니다.
          </motion.div>
        ) : (
          <div className="space-y-2">
            {todos.map((t) => (
              <TodoRow key={t.id} t={t} onToggle={() => onToggle(t)} onRemove={() => onRemove(t.id)} />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TodoRow({ t, onToggle, onRemove }) {
  const today = yyyyMmDd(new Date());
  const overdue = !t.done && t.due_date && t.due_date < today;
  const dueLabel = t.due_date ? (t.due_date === today ? "오늘" : t.due_date) : null;
  const gain = XP_BY_PRIORITY[t.priority] || 0;
  const est = Number(t.estimate_minutes || 0);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onToggle}>
        <div className="pt-0.5">
          {t.done ? <CheckCircle2 className="h-5 w-5 text-slate-900" /> : <Circle className="h-5 w-5 text-slate-300" />}
        </div>

        <div className="min-w-0">
          <div className={`truncate text-sm font-medium ${t.done ? "text-slate-400 line-through" : "text-slate-900"}`}>
            {t.title}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{priorityLabel(t.priority)}</span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">+{gain} XP</span>
            {est ? <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">~{est}m</span> : null}

            {dueLabel ? (
              <span
                className={`rounded-full border px-2 py-0.5 ${
                  overdue ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"
                }`}
              >
                마감 {dueLabel}
              </span>
            ) : null}

            {(t.tags || []).slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </button>

      <button
        className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:bg-slate-50 md:opacity-0 md:group-hover:opacity-100"
        onClick={onRemove}
        aria-label="remove"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function Field({ icon, label, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-slate-50 text-slate-700">{icon}</span>
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function LootModal({ open, loot, onClose }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.98, opacity: 0, y: 6 }}
            transition={{ type: "spring", stiffness: 220, damping: 24 }}
            className="w-[min(520px,100%)] rounded-3xl border border-slate-200 bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Dice6 className="h-4 w-4" />
              상자 오픈
            </div>

            <div className="mt-5 flex items-center justify-center">
              <motion.div
                initial={{ rotate: -2 }}
                animate={{ rotate: [0, -2, 2, -1, 1, 0] }}
                transition={{ duration: 0.6 }}
                className="rounded-3xl border border-slate-200 bg-slate-50 px-6 py-5 text-center"
              >
                <div className="text-xs text-slate-500">결과</div>
                <div className="mt-1 text-xl font-semibold">{loot?.label || "-"}</div>
                <div className="mt-2 text-sm text-slate-600">보너스 +{loot?.bonus ?? 0} XP</div>
              </motion.div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
                onClick={onClose}
              >
                닫기
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Toast({ toast, onClose }) {
  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.title + toast.desc}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="fixed bottom-6 left-1/2 z-50 w-[min(520px,calc(100%-24px))] -translate-x-1/2"
        >
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{toast.title}</div>
              <div className="mt-0.5 text-xs text-slate-500">{toast.desc}</div>
            </div>
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50"
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function AuthCard({ email, setEmail, onLogin, msg, loading }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Gift className="h-4 w-4" />
        로그인
      </div>
      <div className="mt-2 text-xs text-slate-500">이메일 OTP/매직링크</div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onLogin();
          }}
        />
        <button
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          onClick={onLogin}
          disabled={loading}
        >
          시작
        </button>
      </div>

      {msg ? <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">{msg}</div> : null}

      <div className="mt-4 text-xs text-slate-500">로그인하면 기기 바꿔도 데이터가 유지됩니다.</div>
    </Card>
  );
}

function SetupCard({ onSave }) {
  const [url, setUrl] = useState(() => safeGet(LS_URL_KEY));
  const [anon, setAnon] = useState(() => safeGet(LS_ANON_KEY));
  const [warn, setWarn] = useState("");

  return (
    <Card>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Settings className="h-4 w-4" />
        연결 설정
      </div>

      <div className="mt-2 text-xs text-slate-500">
        Supabase의 <span className="font-semibold">Project URL</span>과 <span className="font-semibold">anon public key</span>를 붙여넣으세요.
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <div className="text-xs font-medium text-slate-700">Project URL</div>
          <input
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="https://xxxx.supabase.co"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700">anon public key</div>
          <input
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            placeholder="eyJhbGciOi..."
            value={anon}
            onChange={(e) => setAnon(e.target.value)}
          />
        </div>

        {warn ? <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-700">{warn}</div> : null}

        <button
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-sm hover:opacity-90"
          onClick={() => {
            setWarn("");
            const u = url.trim();
            const a = anon.trim();
            if (!u || !a) {
              setWarn("URL과 anon key를 모두 입력해주세요.");
              return;
            }
            if (a.toLowerCase().includes("service_role")) {
              setWarn("⚠️ service_role 키는 절대 넣으면 안 됩니다. anon(public)만 사용하세요.");
              return;
            }
            onSave(u, a);
          }}
        >
          저장하고 시작
        </button>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
          <div className="font-semibold">DB 체크(필수)</div>
          <div className="mt-2">todos 테이블에 소요시간 컬럼이 필요합니다:</div>
          <pre className="mt-2 overflow-auto rounded-2xl bg-white p-3 text-[11px]">alter table public.todos add column if not exists estimate_minutes int;</pre>
          <div className="mt-2 text-slate-500">RLS 정책/테이블 생성은 이전 안내대로 설정하세요.</div>
        </div>
      </div>
    </Card>
  );
}
