export type User = {
  id: number;
  username: string;
};

export type RuntimeState = {
  accountId: number;
  accountKey: string;
  clientId: string;
  state: string;
  qr: string | null;
  pairingCode: string | null;
  error: string | null;
  ready: boolean;
  startedAt: string;
};

export type Account = {
  id: number;
  accountId: string;
  clientId: string;
  displayName: string;
  phoneHint: string | null;
  status: "enabled" | "disabled" | "deleted";
  loginState: string;
  isCurrent: boolean;
  lastSeenAt: string | null;
  lastQrAt: string | null;
  disabledAt: string | null;
  deletedAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  runtime: RuntimeState | null;
};

export type Job = {
  id: number;
  accountId: number;
  accountName: string;
  mode: "single" | "automatic" | "manual";
  status: string;
  messageText: string;
  intervalMs: number;
  dailyLimit: number;
  retryLimit: number;
  totalCount: number;
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobItem = {
  id: number;
  jobId: number;
  recipientPhone: string;
  contactName: string | null;
  chatId: string | null;
  status: string;
  attemptCount: number;
  messageId: string | null;
  errorMessage: string | null;
  latestReplyText: string | null;
  latestReplyAt: string | null;
  conversationId: number | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobDetail = {
  job: Job;
  items: JobItem[];
};

export type LeadLevel = "A" | "B" | "C";

export type Conversation = {
  id: number;
  accountId: number;
  accountName: string;
  chatId: string;
  contactPhone: string | null;
  contactName: string | null;
  lastMessageText: string | null;
  lastMessageType: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageAt: string | null;
  unreadCount: number;
  historyCursorAt: string | null;
  hasMore: boolean;
  lastSyncedAt: string | null;
  leadLevel: LeadLevel | null;
  leadReason: string | null;
  leadEvidence: string[];
  leadConfidence: number | null;
  leadScoreStatus: "unscored" | "pending" | "scoring" | "scored" | "failed" | "disabled" | "manual";
  leadScoreError: string | null;
  leadScoredAt: string | null;
  leadScoreSignature: string | null;
  leadManualLocked: boolean;
  leadManualNote: string | null;
  leadManualUserId: number | null;
  leadManualAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: number;
  accountId: number;
  conversationId: number;
  messageId: string;
  chatId: string;
  senderId: string | null;
  recipientId: string | null;
  direction: "inbound" | "outbound";
  messageType: string;
  body: string | null;
  hasMedia: boolean;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaSize: number | null;
  mediaMetadata: string | null;
  waTimestamp: string;
  jobId: number | null;
  jobItemId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationDetail = {
  conversation: Conversation;
  messages: ConversationMessage[];
};

export type ReachListRow = {
  conversationId: number;
  accountId: number;
  accountName: string;
  ownWhatsappPhone: string | null;
  updatedAt: string;
  companyName: string;
  peerWhatsappAccount: string;
  peerCity: string;
  peerSource: string;
  peerLink: string;
  latestPostAt: string | null;
  isReached: boolean;
  touchedAt: string | null;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/wa/manager/api${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

export const api = {
  me: () => request<{ user: User | null }>("/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  accounts: () => request<{ accounts: Account[] }>("/accounts"),
  createAccount: (payload: { displayName: string; phoneHint?: string; remark?: string }) =>
    request<{ account: Account }>("/accounts", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateAccount: (id: number, payload: { displayName: string; phoneHint?: string; remark?: string }) =>
    request<{ account: Account }>(`/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  enableAccount: (id: number) => request<{ account: Account }>(`/accounts/${id}/enable`, { method: "POST" }),
  disableAccount: (id: number) => request<{ account: Account }>(`/accounts/${id}/disable`, { method: "POST" }),
  deleteAccount: (id: number) => request<{ ok: boolean }>(`/accounts/${id}`, { method: "DELETE" }),
  switchAccount: (id: number) => request<{ account: Account; runtime: RuntimeState }>(`/accounts/${id}/switch`, { method: "POST" }),
  qrLogin: (id: number) => request<{ runtime: RuntimeState }>(`/accounts/${id}/login/qr`, { method: "POST" }),
  pairingCode: (id: number, phoneNumber: string) =>
    request<{ pairingCode: string; runtime: RuntimeState }>(`/accounts/${id}/login/pairing-code`, {
      method: "POST",
      body: JSON.stringify({ phoneNumber })
    }),
  sendSingle: (phoneNumber: string, messageText: string) =>
    request<{ jobId: number; item: JobItem }>("/messages/send", {
      method: "POST",
      body: JSON.stringify({ phoneNumber, messageText })
    }),
  jobs: () => request<{ jobs: Job[] }>("/jobs"),
  job: (id: number) => request<JobDetail>(`/jobs/${id}`),
  createJob: (payload: {
    recipients: string[];
    messageText: string;
    mode: "automatic" | "manual";
    intervalMs: number;
    dailyLimit: number;
    retryLimit: number;
  }) =>
    request<JobDetail>("/jobs", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  pauseJob: (id: number) => request<JobDetail>(`/jobs/${id}/pause`, { method: "POST" }),
  resumeJob: (id: number) => request<JobDetail>(`/jobs/${id}/resume`, { method: "POST" }),
  stopJob: (id: number) => request<JobDetail>(`/jobs/${id}/stop`, { method: "POST" }),
  sendJobItem: (jobId: number, itemId: number) =>
    request<JobDetail>(`/jobs/${jobId}/items/${itemId}/send`, { method: "POST" }),
  conversations: (accountId?: number) =>
    request<{ conversations: Conversation[] }>(accountId ? `/conversations?accountId=${accountId}` : "/conversations"),
  reachList: (accountId?: number) =>
    request<{ rows: ReachListRow[] }>(accountId ? `/conversations/reach-list?accountId=${accountId}` : "/conversations/reach-list"),
  createConversation: (payload: { phoneNumber: string; contactName?: string }) =>
    request<ConversationDetail>("/conversations", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateConversationContactName: (id: number, contactName: string) =>
    request<{ conversation: Conversation }>(`/conversations/${id}/contact`, {
      method: "PATCH",
      body: JSON.stringify({ contactName })
    }),
  conversationMessages: (id: number, markRead = true) =>
    request<ConversationDetail>(`/conversations/${id}/messages?markRead=${markRead ? "true" : "false"}`),
  sendConversationMessage: (id: number, messageText: string) =>
    request<ConversationDetail & { jobId: number; item: JobItem }>(`/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ messageText })
    }),
  syncOlderConversation: (id: number) =>
    request<ConversationDetail & { result: { fetchedCount: number; savedCount: number; hasMore: boolean } }>(
      `/conversations/${id}/sync-older`,
      { method: "POST" }
    ),
  scoreConversationLead: (id: number) =>
    request<{ conversation: Conversation }>(`/conversations/${id}/lead-score`, { method: "POST" }),
  updateConversationLeadLevel: (
    id: number,
    payload: { level?: LeadLevel; leadLevel?: LeadLevel; manualNote?: string; manualLocked?: boolean }
  ) =>
    request<{ conversation: Conversation }>(`/conversations/${id}/lead-level`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  testMessage: (payload: { accountId: number; chatId: string; body: string; direction?: "inbound" | "outbound" }) =>
    request<{ result: { inserted: boolean; conversationId: number; messageId: string } }>("/conversations/test-message", {
      method: "POST",
      body: JSON.stringify({ ...payload, confirm: "local-test" })
    })
};
