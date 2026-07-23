import {
  CheckCircle2,
  CircleStop,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Power,
  QrCode,
  RefreshCcw,
  Send,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
  XCircle
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Account, Conversation, ConversationDetail, Job, JobDetail, LeadLevel, ReachListRow, User, api } from "./api";

type Notice = {
  type: "ok" | "error";
  message: string;
};

const statusLabels: Record<string, string> = {
  enabled: "启用",
  disabled: "禁用",
  new: "未登录",
  initializing: "连接中",
  qr: "待扫码",
  pairing: "配对中",
  authenticated: "已认证",
  ready: "在线",
  auth_failure: "认证失败",
  disconnected: "离线",
  logged_out: "已登出",
  queued: "排队",
  running: "发送中",
  manual_waiting: "手动",
  paused: "暂停",
  stopped: "停止",
  completed: "完成",
  failed: "失败",
  pending: "待发",
  sending: "发送中",
  sent: "已发",
  inbound: "收到",
  outbound: "发出",
  skipped: "跳过",
  canceled: "取消"
};

const leadStatusLabels: Record<string, string> = {
  unscored: "未判断",
  pending: "待判断",
  scoring: "判断中",
  scored: "已判断",
  failed: "判断失败",
  disabled: "未启用",
  manual: "人工"
};

const leadLevelOptions: LeadLevel[] = ["A", "B", "C"];

function label(value: string) {
  return statusLabels[value] || value;
}

function splitRecipients(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,;，；]+/)
        .map((item) => item.replace(/\D/g, ""))
        .filter(Boolean)
    )
  );
}

function defaultScanName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `扫码账号 ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function isPendingScanAccount(account: Account) {
  return !account.lastSeenAt && ["new", "initializing", "qr", "pairing", "authenticated", "disconnected", "logged_out", "auth_failure"].includes(account.loginState);
}

function conversationTitle(conversation: Conversation) {
  return conversation.contactName || conversation.contactPhone || conversation.chatId;
}

function conversationPreview(conversation: Conversation) {
  if (conversation.lastMessageText) {
    return conversation.lastMessageText;
  }

  if (conversation.lastMessageType) {
    return `[${conversation.lastMessageType}]`;
  }

  return "新对话";
}

function formatMessageTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString();
}

function emptyCell(value: string | null | undefined) {
  return value || "";
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{label(value)}</span>;
}

function leadStatusText(conversation: Conversation) {
  if (conversation.leadScoreStatus === "failed" && conversation.leadScoreError) {
    return conversation.leadScoreError;
  }

  if (conversation.leadReason) {
    return conversation.leadReason;
  }

  return leadStatusLabels[conversation.leadScoreStatus] || "未判断";
}

function LeadLevelBadge({ conversation }: { conversation: Conversation }) {
  if (!conversation.leadLevel) {
    return (
      <span className={`lead-badge lead-badge-${conversation.leadScoreStatus}`}>
        {leadStatusLabels[conversation.leadScoreStatus] || "未判断"}
      </span>
    );
  }

  return (
    <span className={`lead-badge lead-badge-${conversation.leadLevel.toLowerCase()}`}>
      {conversation.leadLevel} 类{conversation.leadManualLocked ? " 锁定" : ""}
    </span>
  );
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
  tone = "neutral",
  type = "button"
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`icon-button icon-button-${tone}`}
      type={type}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function TextIconButton({
  title,
  children,
  onClick,
  disabled,
  tone = "neutral",
  type = "button"
}: {
  title?: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`text-icon-button text-icon-button-${tone}`}
      type={type}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function LoginView({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("ChangeMe");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setNotice(null);

    try {
      const result = await api.login(username, password);
      onLogin(result.user);
    } catch (error) {
      setNotice({ type: "error", message: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div>
          <p className="eyebrow">WhatsApp Contact</p>
        </div>
        <label>
          管理员
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          密码
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {notice && <div className={`notice notice-${notice.type}`}>{notice.message}</div>}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <Power size={18} />}
          登录
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [reachRows, setReachRows] = useState<ReachListRow[]>([]);
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const selectedConversationIdRef = useRef<number | null>(null);
  const conversationRequestRef = useRef(0);
  const [olderLoading, setOlderLoading] = useState(false);
  const [activeLoginAccountId, setActiveLoginAccountId] = useState<number | null>(null);
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState({ displayName: "", phoneHint: "", remark: "" });
  const [newConversation, setNewConversation] = useState({ phoneNumber: "", contactName: "" });
  const [chatMessage, setChatMessage] = useState("");
  const [batchText, setBatchText] = useState("");
  const [batchMessage, setBatchMessage] = useState("");
  const [batchMode, setBatchMode] = useState<"automatic" | "manual">("automatic");
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [dailyLimit, setDailyLimit] = useState(80);
  const [retryLimit, setRetryLimit] = useState(1);
  const [manualLeadLevel, setManualLeadLevel] = useState<LeadLevel>("B");
  const [manualLeadNote, setManualLeadNote] = useState("");
  const [contactNameDraft, setContactNameDraft] = useState("");

  const currentAccount = useMemo(() => accounts.find((account) => account.isCurrent), [accounts]);
  const activeLoginAccount = useMemo(
    () => accounts.find((account) => account.id === activeLoginAccountId) || null,
    [accounts, activeLoginAccountId]
  );
  const currentRuntime = currentAccount?.runtime || null;
  const currentReady = Boolean(currentRuntime?.ready);
  const recipients = useMemo(() => splitRecipients(batchText), [batchText]);
  const pendingScanAccounts = useMemo(() => accounts.filter(isPendingScanAccount), [accounts]);
  const savedAccounts = useMemo(() => accounts.filter((account) => !isPendingScanAccount(account)), [accounts]);
  const reusableScanAccount = pendingScanAccounts[0] || null;

  useEffect(() => {
    if (!conversationDetail) {
      setManualLeadLevel("B");
      setManualLeadNote("");
      setContactNameDraft("");
      return;
    }

    setManualLeadLevel(conversationDetail.conversation.leadLevel || "B");
    setManualLeadNote(conversationDetail.conversation.leadManualNote || "");
    setContactNameDraft(conversationDetail.conversation.contactName || "");
  }, [
    conversationDetail?.conversation.id,
    conversationDetail?.conversation.contactName,
    conversationDetail?.conversation.leadLevel,
    conversationDetail?.conversation.leadManualNote
  ]);

  async function refreshAll(selectedJobId?: number | null) {
    const openedConversationId = selectedConversationIdRef.current;
    const [accountResult, jobResult, conversationResult, reachResult] = await Promise.all([
      api.accounts(),
      api.jobs(),
      api.conversations(),
      api.reachList()
    ]);
    setAccounts(accountResult.accounts);
    setJobs(jobResult.jobs);
    setConversations(conversationResult.conversations);
    setReachRows(reachResult.rows);

    const detailId = selectedJobId === undefined ? jobDetail?.job.id : selectedJobId;
    if (detailId) {
      try {
        setJobDetail(await api.job(detailId));
      } catch {
        setJobDetail(null);
      }
    }

    if (openedConversationId && conversationResult.conversations.some((conversation) => conversation.id === openedConversationId)) {
      try {
        const detail = await api.conversationMessages(openedConversationId);
        if (selectedConversationIdRef.current === openedConversationId) setConversationDetail(detail);
      } catch {
        setConversationDetail(null);
      }
    } else if (openedConversationId) {
      setConversationDetail(null);
    }

    if (activeLoginAccountId) {
      const activeAccount = accountResult.accounts.find((account) => account.id === activeLoginAccountId);
      if (!activeAccount || activeAccount.loginState === "ready") {
        setActiveLoginAccountId(null);
        setPairingCode(null);
      }
    }
  }

  async function refreshConversationLists() {
    const [conversationResult, reachResult] = await Promise.all([api.conversations(), api.reachList()]);
    setConversations(conversationResult.conversations);
    setReachRows(reachResult.rows);
  }

  async function applyConversationUpdate(conversation: Conversation) {
    setConversationDetail((previous) => {
      if (!previous || previous.conversation.id !== conversation.id) {
        return previous;
      }

      return {
        ...previous,
        conversation
      };
    });
    await refreshConversationLists();
  }

  async function openConversation(conversationId: number) {
    const requestId = ++conversationRequestRef.current;
    selectedConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    const detail = await api.conversationMessages(conversationId);
    if (requestId !== conversationRequestRef.current) return;
    setConversationDetail(detail);
    const [conversationResult, reachResult] = await Promise.all([api.conversations(), api.reachList()]);
    setConversations(conversationResult.conversations);
    setReachRows(reachResult.rows);
  }

  async function syncOlderConversation() {
    if (!conversationDetail || olderLoading) {
      return;
    }

    setOlderLoading(true);
    try {
      const detail = await api.syncOlderConversation(conversationDetail.conversation.id);
      setConversationDetail(detail);
      const [conversationResult, reachResult] = await Promise.all([api.conversations(), api.reachList()]);
      setConversations(conversationResult.conversations);
      setReachRows(reachResult.rows);
    } finally {
      setOlderLoading(false);
    }
  }

  async function scoreLeadLevel() {
    if (!conversationDetail) {
      return;
    }

    await runAction(async () => {
      const result = await api.scoreConversationLead(conversationDetail.conversation.id);
      await applyConversationUpdate(result.conversation);
    }, "线索等级已重新判断");
  }

  async function lockLeadLevel() {
    if (!conversationDetail) {
      return;
    }

    await runAction(async () => {
      const result = await api.updateConversationLeadLevel(conversationDetail.conversation.id, {
        level: manualLeadLevel,
        manualNote: manualLeadNote,
        manualLocked: true
      });
      await applyConversationUpdate(result.conversation);
    }, "线索等级已人工锁定");
  }

  async function unlockLeadLevel() {
    if (!conversationDetail) {
      return;
    }

    await runAction(async () => {
      const result = await api.updateConversationLeadLevel(conversationDetail.conversation.id, {
        manualLocked: false
      });
      await applyConversationUpdate(result.conversation);
    }, "线索等级已解除锁定");
  }

  async function saveContactName() {
    if (!conversationDetail) {
      return;
    }

    await runAction(async () => {
      const result = await api.updateConversationContactName(conversationDetail.conversation.id, contactNameDraft);
      await applyConversationUpdate(result.conversation);
    }, "联系人备注已保存");
  }

  useEffect(() => {
    api.me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    refreshAll(null).catch((error) => setNotice({ type: "error", message: error.message }));
    const timer = window.setInterval(() => {
      refreshAll().catch(() => {});
    }, 3000);

    return () => window.clearInterval(timer);
  }, [user, activeLoginAccountId, jobDetail?.job.id, conversationDetail?.conversation.id]);

  async function runAction(action: () => Promise<void>, okMessage?: string) {
    setNotice(null);
    try {
      await action();
      if (okMessage) {
        setNotice({ type: "ok", message: okMessage });
      }
    } catch (error) {
      setNotice({ type: "error", message: (error as Error).message });
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  async function addAccount(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const result = reusableScanAccount
        ? await api.updateAccount(reusableScanAccount.id, {
          displayName: newAccount.displayName.trim() || reusableScanAccount.displayName,
          phoneHint: newAccount.phoneHint.trim() || reusableScanAccount.phoneHint || undefined,
          remark: newAccount.remark.trim() || reusableScanAccount.remark || undefined
        })
        : await api.createAccount(newAccount);
      setNewAccount({ displayName: "", phoneHint: "", remark: "" });
      setActiveLoginAccountId(result.account.id);
      setPairingCode(null);
      await api.qrLogin(result.account.id);
      await refreshAll(null);
    }, reusableScanAccount ? "已更新待扫码账号，正在生成二维码" : "账号已添加，正在生成二维码");
  }

  async function scanAddAccount() {
    await runAction(async () => {
      const account = reusableScanAccount || (await api.createAccount({
        displayName: defaultScanName(),
        remark: "扫码添加"
      })).account;
      setActiveLoginAccountId(account.id);
      setPairingCode(null);
      await api.qrLogin(account.id);
      await refreshAll(null);
    }, reusableScanAccount ? "正在继续未完成的扫码" : "正在生成二维码");
  }

  function renderAccountCard(account: Account) {
    return (
      <article className={`row-card ${account.isCurrent ? "row-card-active" : ""}`} key={account.id}>
        <div className="row-head">
          <div className="row-main">
            <strong>{account.displayName}</strong>
            <span>{account.phoneHint || account.accountId}</span>
          </div>
          <div className="row-meta">
            <StatusBadge value={account.status} />
            <StatusBadge value={account.loginState} />
          </div>
        </div>
        <div className="row-actions">
          <IconButton title="切换账号" onClick={() => runAction(async () => { await api.switchAccount(account.id); await refreshAll(null); })} disabled={account.status !== "enabled"} tone="primary">
            <Power size={17} />
          </IconButton>
          <IconButton title="扫码登录" onClick={() => runAction(async () => { setActiveLoginAccountId(account.id); setPairingCode(null); await api.qrLogin(account.id); await refreshAll(null); }, "正在生成二维码")} disabled={account.status !== "enabled"} tone="primary">
            <QrCode size={17} />
          </IconButton>
          <IconButton title="配对码登录" onClick={() => { setActiveLoginAccountId(account.id); setPairingCode(null); }} disabled={account.status !== "enabled"}>
            <KeyRound size={17} />
          </IconButton>
          {account.status === "enabled" ? (
            <IconButton title="禁用账号" onClick={() => runAction(async () => { await api.disableAccount(account.id); await refreshAll(null); })}>
              <PauseCircle size={17} />
            </IconButton>
          ) : (
            <IconButton title="启用账号" onClick={() => runAction(async () => { await api.enableAccount(account.id); await refreshAll(null); })}>
              <PlayCircle size={17} />
            </IconButton>
          )}
          <IconButton
            title="删除账号"
            tone="danger"
            onClick={() => {
              if (window.confirm(`确认删除账号 ${account.displayName}？`)) {
                runAction(async () => { await api.deleteAccount(account.id); await refreshAll(null); }, "账号已删除");
              }
            }}
          >
            <Trash2 size={17} />
          </IconButton>
        </div>
      </article>
    );
  }

  async function loadCsv(file: File | null) {
    if (!file) {
      return;
    }

    const text = await file.text();
    setBatchText((previous) => [previous, text].filter(Boolean).join("\n"));
  }

  async function submitNewConversation(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      const detail = await api.createConversation(newConversation);
      setNewConversation({ phoneNumber: "", contactName: "" });
      selectedConversationIdRef.current = detail.conversation.id;
      setSelectedConversationId(detail.conversation.id);
      setConversationDetail(detail);
      const [conversationResult, reachResult] = await Promise.all([api.conversations(), api.reachList()]);
      setConversations(conversationResult.conversations);
      setReachRows(reachResult.rows);
    }, "会话已创建");
  }

  async function submitChatMessage(event: FormEvent) {
    event.preventDefault();
    if (!conversationDetail) {
      setNotice({ type: "error", message: "请选择会话" });
      return;
    }

    if (!currentReady) {
      setNotice({ type: "error", message: "当前账号离线，无法发送消息" });
      return;
    }

    const text = chatMessage.trim();
    if (!text) {
      setNotice({ type: "error", message: "请输入消息内容" });
      return;
    }

    await runAction(async () => {
      const detail = await api.sendConversationMessage(conversationDetail.conversation.id, text);
      setChatMessage("");
      setConversationDetail(detail);
      const [conversationResult, reachResult, jobResult, jobDetailResult] = await Promise.all([
        api.conversations(),
        api.reachList(),
        api.jobs(),
        api.job(detail.jobId)
      ]);
      setConversations(conversationResult.conversations);
      setReachRows(reachResult.rows);
      setJobs(jobResult.jobs);
      setJobDetail(jobDetailResult);
    }, "消息已发送");
  }

  async function submitBatch(event: FormEvent) {
    event.preventDefault();
    if (!currentReady) {
      setNotice({ type: "error", message: "当前账号离线，无法创建发送任务" });
      return;
    }

    if (recipients.length === 0) {
      setNotice({ type: "error", message: "请输入收件人号码" });
      return;
    }

    if (!window.confirm(`确认创建 ${recipients.length} 条发送任务？`)) {
      return;
    }

    await runAction(async () => {
      const detail = await api.createJob({
        recipients,
        messageText: batchMessage,
        mode: batchMode,
        intervalMs: intervalSeconds * 1000,
        dailyLimit,
        retryLimit
      });
      setBatchText("");
      setBatchMessage("");
      setJobDetail(detail);
      await refreshAll(detail.job.id);
    }, "批量任务已创建");
  }

  if (loading) {
    return (
      <div className="full-loader">
        <Loader2 className="spin" size={28} />
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={setUser} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WhatsApp Contact</p>
        </div>
        <div className="topbar-actions">
          <div className="current-pill">
            <span>{currentAccount ? currentAccount.displayName : "未选择账号"}</span>
            <StatusBadge value={currentAccount ? currentAccount.loginState : "disconnected"} />
          </div>
          <IconButton title="刷新" onClick={() => runAction(() => refreshAll())}>
            <RefreshCcw size={18} />
          </IconButton>
          <IconButton title="退出" onClick={logout}>
            <LogOut size={18} />
          </IconButton>
        </div>
      </header>

      {notice && <div className={`notice notice-${notice.type}`}>{notice.message}</div>}

      <main className="workspace">
        <section className="panel accounts-panel">
          <div className="panel-heading">
            <h2>账号</h2>
            <div className="heading-actions">
              <StatusBadge value={currentReady ? "ready" : "disconnected"} />
              <TextIconButton title="扫码添加 WhatsApp 账号" onClick={scanAddAccount} tone="primary">
                <QrCode size={17} />
                {reusableScanAccount ? "继续扫码" : "扫码添加"}
              </TextIconButton>
            </div>
          </div>

          <form className="compact-form" onSubmit={addAccount}>
            <input
              placeholder="账号名称"
              value={newAccount.displayName}
              onChange={(event) => setNewAccount({ ...newAccount, displayName: event.target.value })}
            />
            <input
              placeholder="手机号"
              value={newAccount.phoneHint}
              onChange={(event) => setNewAccount({ ...newAccount, phoneHint: event.target.value })}
            />
            <input
              placeholder="备注"
              value={newAccount.remark}
              onChange={(event) => setNewAccount({ ...newAccount, remark: event.target.value })}
            />
            <button className="secondary-button" type="submit">
              <QrCode size={17} />
              保存并扫码
            </button>
          </form>

          <div className="list">
            {savedAccounts.map(renderAccountCard)}
          </div>
          {pendingScanAccounts.length > 0 && (
            <details className="pending-scan-accounts">
              <summary>未完成扫码（{pendingScanAccounts.length}）</summary>
              <p>这些账号尚未成功登录，默认不显示在账号主列表。可继续扫码或删除不再需要的记录。</p>
              <div className="list">{pendingScanAccounts.map(renderAccountCard)}</div>
            </details>
          )}
        </section>

        <section className="panel chat-panel">
          <div className="panel-heading">
            <h2>消息</h2>
            <span className="subtle">{currentAccount ? currentAccount.displayName : "请选择账号"}</span>
          </div>

          {activeLoginAccount && (
            <div className="login-box">
              <div className="login-box-head">
                <strong>{activeLoginAccount.displayName}</strong>
                <StatusBadge value={activeLoginAccount.loginState} />
              </div>
              {activeLoginAccount.runtime?.qr ? (
                <div className="qr-wrap">
                  <QRCodeSVG value={activeLoginAccount.runtime.qr} size={220} />
                </div>
              ) : (
                <div className="empty-state qr-waiting">
                  <Loader2 className="spin" size={22} />
                  正在生成二维码
                </div>
              )}
              <div className="pair-row">
                <input placeholder="配对手机号" value={pairingPhone} onChange={(event) => setPairingPhone(event.target.value)} />
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => runAction(async () => {
                    const result = await api.pairingCode(activeLoginAccount.id, pairingPhone);
                    setPairingCode(result.pairingCode);
                    await refreshAll(null);
                  })}
                >
                  <KeyRound size={17} />
                  获取
                </button>
              </div>
              {pairingCode && <div className="pairing-code">{pairingCode}</div>}
            </div>
          )}

          <div className="chat-shell">
            <aside className="chat-sidebar">
              <form className="new-chat-form" onSubmit={submitNewConversation}>
                <input
                  placeholder="添加用户手机号"
                  value={newConversation.phoneNumber}
                  onChange={(event) => setNewConversation({ ...newConversation, phoneNumber: event.target.value })}
                />
                <input
                  placeholder="备注名（可选）"
                  value={newConversation.contactName}
                  onChange={(event) => setNewConversation({ ...newConversation, contactName: event.target.value })}
                />
                <button className="secondary-button" type="submit" disabled={!currentAccount}>
                  <UserPlus size={17} />
                  添加用户
                </button>
              </form>

              <div className="conversation-list chat-conversation-list">
                {conversations.length === 0 ? (
                  <div className="empty-state compact-empty">暂无会话</div>
                ) : (
                  conversations.map((conversation) => (
                    <button
                      className={`conversation-row ${selectedConversationId === conversation.id ? "conversation-row-active" : ""}`}
                      key={conversation.id}
                      onClick={() => runAction(async () => openConversation(conversation.id))}
                    >
                      <div>
                        <div className="conversation-row-title">
                          <strong>{conversationTitle(conversation)}</strong>
                          <div className="conversation-row-meta">
                            <LeadLevelBadge conversation={conversation} />
                            {conversation.lastMessageAt && <small>{formatMessageTime(conversation.lastMessageAt)}</small>}
                          </div>
                        </div>
                        <span>{conversationPreview(conversation)}</span>
                      </div>
                      {conversation.unreadCount > 0 && <span className="unread-dot">{conversation.unreadCount}</span>}
                    </button>
                  ))
                )}
              </div>
            </aside>

            <section className="chat-room">
              {conversationDetail ? (
                <>
                  <div className="chat-room-head">
                    <div className="conversation-title chat-room-title">
                      <div className="chat-title-main">
                        <strong>{conversationTitle(conversationDetail.conversation)}</strong>
                        <LeadLevelBadge conversation={conversationDetail.conversation} />
                      </div>
                      <TextIconButton
                        title="加载更早消息"
                        onClick={() => runAction(syncOlderConversation)}
                        disabled={!conversationDetail.conversation.hasMore || olderLoading}
                      >
                        {olderLoading ? <Loader2 className="spin" size={16} /> : <MessageCircle size={16} />}
                        加载更早
                      </TextIconButton>
                    </div>
                    <div className="contact-name-editor">
                      <input
                        aria-label="联系人备注"
                        placeholder="联系人备注名"
                        value={contactNameDraft}
                        onChange={(event) => setContactNameDraft(event.target.value)}
                        maxLength={180}
                      />
                      <TextIconButton title="保存联系人备注" onClick={saveContactName} tone="primary">
                        保存备注
                      </TextIconButton>
                    </div>
                    <div className="lead-panel">
                      <div className="lead-summary">
                        <span>{leadStatusText(conversationDetail.conversation)}</span>
                        {conversationDetail.conversation.leadScoredAt && (
                          <small>{formatMessageTime(conversationDetail.conversation.leadScoredAt)}</small>
                        )}
                      </div>
                      <div className="lead-controls">
                        <TextIconButton
                          title="重新判断线索等级"
                          onClick={scoreLeadLevel}
                          disabled={conversationDetail.conversation.leadManualLocked || conversationDetail.conversation.leadScoreStatus === "scoring"}
                        >
                          {conversationDetail.conversation.leadScoreStatus === "scoring" ? (
                            <Loader2 className="spin" size={16} />
                          ) : (
                            <RefreshCcw size={16} />
                          )}
                          重判
                        </TextIconButton>
                        <div className="lead-choice-group" aria-label="人工线索等级">
                          {leadLevelOptions.map((level) => (
                            <button
                              className={manualLeadLevel === level ? "selected" : ""}
                              key={level}
                              type="button"
                              onClick={() => setManualLeadLevel(level)}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                        <input
                          className="lead-note-input"
                          placeholder="人工备注"
                          value={manualLeadNote}
                          onChange={(event) => setManualLeadNote(event.target.value)}
                        />
                        <TextIconButton title="人工锁定线索等级" onClick={lockLeadLevel} tone="primary">
                          <Lock size={16} />
                          锁定
                        </TextIconButton>
                        {conversationDetail.conversation.leadManualLocked && (
                          <TextIconButton title="解除人工锁定" onClick={unlockLeadLevel}>
                            <Unlock size={16} />
                            解锁
                          </TextIconButton>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="message-list chat-message-list">
                    {conversationDetail.messages.length === 0 ? (
                      <div className="empty-state compact-empty">还没有消息</div>
                    ) : (
                      conversationDetail.messages.map((message) => (
                        <div className={`message-bubble message-${message.direction}`} key={message.id}>
                          <div className="message-meta">
                            <StatusBadge value={message.direction} />
                            <span>{formatMessageTime(message.waTimestamp)}</span>
                          </div>
                          <p>{message.body || (message.hasMedia ? `[${message.messageType}]` : `[${message.messageType}]`)}</p>
                          {message.hasMedia && <small>媒体：{message.mediaMimeType || message.messageType}</small>}
                        </div>
                      ))
                    )}
                  </div>
                  <form className="chat-compose" onSubmit={submitChatMessage}>
                    <textarea
                      placeholder={currentReady ? "输入消息" : "当前账号离线，无法发送"}
                      value={chatMessage}
                      onChange={(event) => setChatMessage(event.target.value)}
                      rows={3}
                    />
                    <button className="primary-button" type="submit" disabled={!currentReady || !chatMessage.trim()}>
                      <Send size={17} />
                      发送
                    </button>
                  </form>
                </>
              ) : (
                <div className="empty-state chat-empty">选择左侧用户开始聊天</div>
              )}
            </section>
          </div>

          <section className="reach-section">
            <div className="panel-heading">
              <h3>触达列表</h3>
              <span className="subtle">{reachRows.length}</span>
            </div>
            <div className="reach-table-wrap">
              <table className="reach-table">
                <thead>
                  <tr>
                    <th>我方 WhatsApp 号</th>
                    <th>最近消息时间</th>
                    <th>公司名称/商家名称</th>
                    <th>WhatsApp 账号/手机号</th>
                    <th>B 端所在城市</th>
                    <th>B 端来源</th>
                    <th>访问 B 端链接</th>
                    <th>最近发帖时间</th>
                    <th>是否触达</th>
                    <th>触达时间</th>
                  </tr>
                </thead>
                <tbody>
                  {reachRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="reach-empty">暂无触达记录</td>
                    </tr>
                  ) : (
                    reachRows.map((row) => (
                      <tr key={row.conversationId} onClick={() => runAction(async () => openConversation(row.conversationId))}>
                        <td>{emptyCell(row.ownWhatsappPhone)}</td>
                        <td>{formatMessageTime(row.updatedAt)}</td>
                        <td>{emptyCell(row.companyName)}</td>
                        <td>{emptyCell(row.peerWhatsappAccount)}</td>
                        <td>{emptyCell(row.peerCity)}</td>
                        <td>{emptyCell(row.peerSource)}</td>
                        <td>{emptyCell(row.peerLink)}</td>
                        <td>{formatMessageTime(row.latestPostAt)}</td>
                        <td>{row.isReached ? "是" : "否"}</td>
                        <td>{formatMessageTime(row.touchedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="side-stack">
          <section className="panel batch-panel">
            <div className="panel-heading">
              <h2>批量</h2>
              <span className="counter">{recipients.length}</span>
            </div>
          <form className="send-form" onSubmit={submitBatch}>
            <div className="segmented">
              <button type="button" className={batchMode === "automatic" ? "selected" : ""} onClick={() => setBatchMode("automatic")}>
                自动队列
              </button>
              <button type="button" className={batchMode === "manual" ? "selected" : ""} onClick={() => setBatchMode("manual")}>
                逐条确认
              </button>
            </div>
            <textarea placeholder="手机号列表" value={batchText} onChange={(event) => setBatchText(event.target.value)} rows={6} />
            <label className="file-button">
              <Upload size={17} />
              CSV
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(event) => loadCsv(event.target.files?.[0] || null)} />
            </label>
            <textarea placeholder="消息内容" value={batchMessage} onChange={(event) => setBatchMessage(event.target.value)} rows={5} />
            <div className="number-grid">
              <label>
                间隔s
                <input type="number" min={2} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} />
              </label>
              <label>
                日上限
                <input type="number" min={1} value={dailyLimit} onChange={(event) => setDailyLimit(Number(event.target.value))} />
              </label>
              <label>
                失败重试
                <input type="number" min={0} max={5} value={retryLimit} onChange={(event) => setRetryLimit(Number(event.target.value))} />
              </label>
            </div>
            <button className="primary-button" type="submit" disabled={!currentReady}>
              <Send size={17} />
              创建任务
            </button>
          </form>
          </section>

          <section className="panel jobs-panel">
            <div className="panel-heading">
              <h2>任务</h2>
              <span className="subtle">{jobs.length}</span>
            </div>
            <div className="list job-list">
              {jobs.map((job) => (
                <button className={`job-row ${jobDetail?.job.id === job.id ? "job-row-active" : ""}`} key={job.id} onClick={() => runAction(async () => setJobDetail(await api.job(job.id)))}>
                  <span>#{job.id}</span>
                  <strong>{job.accountName}</strong>
                  <StatusBadge value={job.status} />
                  <small>{job.sentCount}/{job.totalCount}</small>
                </button>
              ))}
            </div>

            {jobDetail ? (
              <div className="job-detail">
                <div className="job-tools">
                  <strong>#{jobDetail.job.id}</strong>
                  <StatusBadge value={jobDetail.job.status} />
                  <IconButton title="暂停" onClick={() => runAction(async () => setJobDetail(await api.pauseJob(jobDetail.job.id)))} disabled={!["queued", "running"].includes(jobDetail.job.status)}>
                    <PauseCircle size={17} />
                  </IconButton>
                  <IconButton title="继续" onClick={() => runAction(async () => setJobDetail(await api.resumeJob(jobDetail.job.id)))} disabled={jobDetail.job.status !== "paused" || jobDetail.job.mode !== "automatic"}>
                    <PlayCircle size={17} />
                  </IconButton>
                  <IconButton title="停止" onClick={() => runAction(async () => setJobDetail(await api.stopJob(jobDetail.job.id)))} disabled={["stopped", "completed", "failed"].includes(jobDetail.job.status)}>
                    <CircleStop size={17} />
                  </IconButton>
                </div>
                <div className="progress-bar">
                  <span style={{ width: `${jobDetail.job.totalCount ? (jobDetail.job.sentCount / jobDetail.job.totalCount) * 100 : 0}%` }} />
                </div>
                <div className="item-list">
                  {jobDetail.items.map((item) => (
                    <div className="item-row" key={item.id}>
                      <span>{item.contactName || item.recipientPhone}</span>
                      <StatusBadge value={item.status} />
                      {item.latestReplyText && <span className="reply-chip">回复：{item.latestReplyText}</span>}
                      {item.conversationId && (
                        <IconButton title="打开会话" onClick={() => runAction(async () => openConversation(item.conversationId as number))}>
                          <MessageSquare size={16} />
                        </IconButton>
                      )}
                      {item.status === "sent" && <CheckCircle2 size={16} />}
                      {item.status === "failed" && <XCircle size={16} />}
                      {jobDetail.job.mode === "manual" && item.status === "pending" && jobDetail.job.status === "manual_waiting" && (
                        <IconButton title="发送此条" onClick={() => runAction(async () => setJobDetail(await api.sendJobItem(jobDetail.job.id, item.id)))} disabled={!currentReady} tone="primary">
                          <Send size={16} />
                        </IconButton>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">暂无任务</div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
