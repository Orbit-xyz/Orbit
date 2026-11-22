"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Package,
  Users,
  SendHorizontal,
  Link2,
  Code2,
  ArrowUpRight,
  LogOut,
  ChevronDown,
  Menu,
  X,
  ShieldCheck,
  Globe,
  Wallet,
  Copy,
  Check,
  Pencil,
  Bell,
  UserCog,
  UsersRound,
  Gift,
  Sparkles,
  Search,
  BarChart3,
  Mail,
  FileSpreadsheet,
  Droplets,
} from "lucide-react";
import { useDashboardTheme, type ThemePreference } from "@/lib/dashboard-theme";
import { useFiatRates, type FiatCurrency } from "@/lib/fiat-rates";
import { Brand } from "@/components/layout/brand";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notification-context";
import { DashboardTab, NetworkId, NETWORKS, SubscriptionPlan } from "./dashboard-types";
import { OverviewView } from "./views/overview-view";
import { PlansView, INITIAL_PLANS } from "./views/plans-view";
import { SubscribersView, INITIAL_SUBSCRIBERS } from "./views/subscribers-view";
import { PayrollView } from "./views/payroll-view";
import { MultisigView } from "./views/multisig-view";
import { GiftPassesView } from "./views/gift-passes-view";
import { DomainsView } from "./views/domains-view";
import { PaymentLinksView } from "./views/payment-links-view";
import { DevelopersView } from "./views/developers-view";
import { RetentionView } from "./views/retention-view";
import { NotificationTemplatesView } from "./views/notification-templates-view";
import { TeamView } from "./views/team-view";
import { TaxComplianceView } from "./views/tax-compliance-view";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { VaultModal } from "./modals/vault-modal";
import { DeployVaultModal } from "./modals/deploy-vault-modal";
import { CreatePlanModal } from "./modals/create-plan-modal";
import { CommandPalette } from "./modals/command-palette";
import { ReportsTaxWizardModal } from "./modals/reports-tax-wizard-modal";
import { NotificationDrawer } from "./drawers/notification-drawer";
import { NotificationToasts } from "./notification-toasts";
import { DOCS_URL } from "@/lib/links";

export function DashboardShell() {
  const t = useTranslations("Dashboard");
  const tc = useTranslations("Common");
  const router = useRouter();
  const { user, signOut, updateVault, updateBusinessName, walletNetworkWarning, disconnectWallet } = useAuth();
  const { unreadCount, toggleDrawer } = useNotifications();
  const { theme, setTheme } = useDashboardTheme();
  const { currency, setCurrency, error: fiatError } = useFiatRates();
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  const handleSignOut = () => {
    signOut();
    router.push("/signin");
  };
  const [activeNetwork, setActiveNetwork] = useState<NetworkId>("stellar-testnet");
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCreatePlanOpen, setIsCreatePlanOpen] = useState(false);
  const [payrollAutoUpload, setPayrollAutoUpload] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>(INITIAL_PLANS);
  const [subscribers, setSubscribers] = useState(INITIAL_SUBSCRIBERS);
  const [toastNotification, setToastNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isReportsWizardOpen, setIsReportsWizardOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [isEditingBusinessName, setIsEditingBusinessName] = useState(false);
  const [businessNameInput, setBusinessNameInput] = useState("");
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  type LiveStatus = "connected" | "reconnecting" | "disconnected";
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("disconnected");
  const [lostConnectionAt, setLostConnectionAt] = useState<number | null>(null);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const liveReconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      setLiveStatus("disconnected");
      setLostConnectionAt(Date.now());
      return undefined;
    }

    let disposed = false;

    const connect = () => {
      if (disposed) return;
      if (liveSocketRef.current?.readyState === WebSocket.OPEN) return;
      setLiveStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "disconnected");
      const socket = new WebSocket(wsUrl);
      liveSocketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        reconnectAttemptRef.current = 0;
        setLiveStatus("connected");
        setLostConnectionAt(null);
      };

      socket.onclose = () => {
        if (disposed) return;
        setLiveStatus("reconnecting");
        setLostConnectionAt((previous) => previous ?? Date.now());
        const delays = [1000, 2000, 5000, 10000];
        const delay = delays[Math.min(reconnectAttemptRef.current, delays.length - 1)];
        const jitter = Math.floor(Math.random() * 500);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay + jitter);
      };

      socket.onerror = () => socket.close();
    };

    connect();
    liveReconnectRef.current = connect;

    const handleOffline = () => {
      setLiveStatus("disconnected");
      setLostConnectionAt(Date.now());
    };
    const handleOnline = () => {
      reconnectAttemptRef.current = 0;
      connect();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      disposed = true;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      liveReconnectRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (liveSocketRef.current) {
        liveSocketRef.current.onclose = null;
        liveSocketRef.current.close();
      }
    };
  }, []);

  const [staleWarningVisible, setStaleWarningVisible] = useState(false);
  useEffect(() => {
    if (!lostConnectionAt) {
      setStaleWarningVisible(false);
      return;
    }
    const update = () => setStaleWarningVisible(Date.now() - lostConnectionAt > 30_000);
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lostConnectionAt]);

  const reconnectNow = () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (liveSocketRef.current) {
      liveSocketRef.current.onclose = null;
      liveSocketRef.current.close();
      liveSocketRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setLiveStatus("reconnecting");
    setLostConnectionAt(Date.now());
    liveReconnectRef.current?.();
  };

  // Global keyboard shortcut: Cmd+K (macOS) / Ctrl+K (Windows/Linux) (#308)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Auto-dismiss toast after delay
  useEffect(() => {
    if (!toastNotification) return;
    const timer = setTimeout(() => setToastNotification(null), 3500);
    return () => clearTimeout(timer);
  }, [toastNotification]);

  if (!user) return null;

  const handleSaveBusinessName = (e: React.FormEvent) => {
    e.preventDefault();
    if (businessNameInput.trim()) {
      updateBusinessName(businessNameInput.trim());
      setIsEditingBusinessName(false);
    }
  };

  const copyMerchantId = () => {
    navigator.clipboard.writeText(user.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCreatePlan = (newPlan: SubscriptionPlan) => {
    setPlans((prev) => [newPlan, ...prev]);
    setToastNotification({
      type: "success",
      message: `Plan "${newPlan.name}" created successfully!`,
    });
  };

  const handleDisbursePayroll = () => {
    setActiveTab("payroll");
    setPayrollAutoUpload(true);
  };

  const handleCopySettlementAddress = async () => {
    const address = user?.linkedVaults?.stellar || user?.walletAddress || "";
    if (!address) {
      setToastNotification({
        type: "error",
        message: "No settlement address configured for this merchant profile",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      setToastNotification({
        type: "success",
        message: `Settlement address copied: ${address.slice(0, 6)}...${address.slice(-4)}`,
      });
    } catch {
      setToastNotification({
        type: "error",
        message: "Failed to copy settlement address to clipboard",
      });
    }
  };

  const requestTestnetFaucet = async () => {
    if (!user.walletAddress || activeNetwork !== "stellar-testnet") return;
    setFaucetBusy(true);
    setFaucetStatus("Funding XLM and USDC...");
    try {
      const response = await fetch("/api/dev/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: user.walletAddress }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Faucet request failed");
      setFaucetStatus("Testnet funds requested");
      window.dispatchEvent(new CustomEvent("orbit:balance-refresh"));
      setTimeout(() => setFaucetStatus(null), 3000);
    } catch (error) {
      setFaucetStatus(error instanceof Error ? error.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  };

  const navItems = [
    {
      id: "overview" as DashboardTab,
      label: t("nav.overview"),
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: "plans" as DashboardTab,
      label: t("nav.plans"),
      icon: Package,
      badge: "3",
    },
    {
      id: "subscribers" as DashboardTab,
      label: t("nav.subscribers"),
      icon: Users,
      badge: "148",
    },
    {
      id: "retention" as DashboardTab, label: t("nav.retention"), icon: BarChart3, badge: null,
    },
    {
      id: "templates" as DashboardTab, label: t("nav.templates"), icon: Mail, badge: null,
    },
    {
      id: "payroll" as DashboardTab,
      label: t("nav.payroll"),
      icon: SendHorizontal,
      badge: t("badges.superpower"),
    },
    {
      id: "multisig" as DashboardTab,
      label: t("nav.multisig"),
      icon: UsersRound,
      badge: t("badges.multisig"),
    },
    {
      id: "passes" as DashboardTab,
      label: t("nav.passes"),
      icon: Gift,
      badge: t("badges.oneTime"),
    },
    {
      id: "domains" as DashboardTab,
      label: t("nav.domains"),
      icon: Globe,
      badge: null,
    },
    {
      id: "links" as DashboardTab,
      label: t("nav.links"),
      icon: Link2,
      badge: null,
    },
    {
      id: "team" as DashboardTab,
      label: t("nav.team"),
      icon: UserCog,
      badge: null,
    },
    {
      id: "tax" as DashboardTab,
      label: t("nav.tax"),
      icon: ShieldCheck,
      badge: "IRS/VAT",
    },
    {
      id: "developers" as DashboardTab,
      label: t("nav.developers"),
      icon: Code2,
      badge: t("badges.api"),
    },
  ];

  return (
    <div className="orbit-dashboard min-h-screen bg-[#fafafb] flex text-[#09090b]">
      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-black/10 flex flex-col justify-between transition-transform duration-200 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="h-16 px-6 border-b border-black/10 flex items-center justify-between">
            <Brand variant="black" />
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-black/5 text-neutral-600 border border-black/10">
              {t("merchantBadge")}
            </span>
          </div>

          {/* Workspace & Merchant Pill */}
          <div className="p-4 border-b border-black/5">
            <div className="p-3.5 rounded-lg bg-neutral-50 border border-black/5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                  {t("businessEntity")}
                </div>
                {!isEditingBusinessName && (
                  <button
                    onClick={() => {
                      setBusinessNameInput(user.businessName);
                      setIsEditingBusinessName(true);
                    }}
                    className="text-[10px] text-neutral-400 hover:text-black flex items-center gap-1 font-medium transition-colors"
                    title={t("renameCompany")}
                  >
                    <Pencil size={10} />
                    <span>{tc("edit")}</span>
                  </button>
                )}
              </div>

              {!isEditingBusinessName ? (
                <div className="text-sm font-bold text-black truncate mt-0.5">
                  {user.businessName}
                </div>
              ) : (
                <form onSubmit={handleSaveBusinessName} className="mt-1.5 space-y-1.5">
                  <input
                    type="text"
                    required
                    placeholder={t("businessNamePlaceholder")}
                    value={businessNameInput}
                    onChange={(e) => setBusinessNameInput(e.target.value)}
                    className="w-full text-xs font-bold border border-black/20 rounded px-2 py-1 bg-white text-black focus:outline-hidden focus:ring-1 focus:ring-black"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsEditingBusinessName(false)}
                      className="text-[10px] px-2 py-0.5 rounded border border-black/10 hover:bg-black/5"
                    >
                      {tc("cancel")}
                    </button>
                    <button
                      type="submit"
                      className="text-[10px] px-2.5 py-0.5 rounded bg-black text-white hover:bg-neutral-800 font-semibold"
                    >
                      {tc("save")}
                    </button>
                  </div>
                </form>
              )}

              <button
                onClick={copyMerchantId}
                className="hover:text-black font-mono text-[10px] text-neutral-500 flex items-center gap-1 mt-2 transition-colors"
                title={t("copyMerchantId")}
              >
                <span>ID: {user.id}</span>
                {copiedId ? (
                  <Check size={10} className="text-emerald-600" />
                ) : (
                  <Copy size={10} />
                )}
              </button>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-black text-white"
                      : "text-neutral-600 hover:text-black hover:bg-neutral-100"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                        isActive
                          ? "bg-white/20 text-white"
                          : "bg-neutral-100 text-neutral-600 border border-black/5"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Linked Vaults Indicator & Sign Out */}
        <div className="p-4 border-t border-black/10 space-y-3">
          {/* Linked Vaults Status Pill */}
          <button
            onClick={() => setIsVaultModalOpen(true)}
            className="w-full text-left p-2.5 rounded-lg border border-black/10 hover:border-black/30 bg-neutral-50/60 hover:bg-neutral-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck size={12} className="text-emerald-600" />
                {user.customContractId ? "Custom Vault" : t("settlementVault")}
              </span>
              <span className="text-[10px] font-mono text-emerald-600 font-bold">
                {user.customContractId ? "Active" : t("ready")}
              </span>
            </div>
            <div className="text-[11px] font-mono text-neutral-600 truncate mt-1">
              {user.customContractId || t("treasuryDescription")}
            </div>
          </button>

          {user.walletAddress && <button type="button" onClick={disconnectWallet} className="w-full rounded border border-black/10 px-3 py-2 text-left text-xs text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2" aria-label="Disconnect Freighter wallet">Disconnect wallet</button>}
          {/* User Sign Out */}
          <div className="flex items-center justify-between pt-1 text-xs text-neutral-500">
            <span className="truncate max-w-[140px] font-semibold text-black" title={user.businessName}>
              {user.businessName}
            </span>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded hover:bg-black/5 text-neutral-500 hover:text-black transition-colors"
              title={t("signOut")}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 px-6 border-b border-black/10 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={liveStatus !== "connected" ? reconnectNow : undefined}
              title={liveStatus === "connected" ? "Live data connection" : "Reconnect live data"}
              className="flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white px-2.5 text-xs font-semibold"
            >
              {liveStatus === "connected" ? "🟢 Live" : liveStatus === "reconnecting" ? "🟡 Reconnecting..." : "🔴 Offline"}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsNetworkDropdownOpen((open) => !open)}
                aria-expanded={isNetworkDropdownOpen}
                className="flex h-8 items-center gap-2 rounded-md border border-black/10 bg-white px-2.5 text-xs font-medium text-neutral-800"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {NETWORKS[activeNetwork].name}
                <ChevronDown size={12} />
              </button>
              {isNetworkDropdownOpen && (
                <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-black/10 bg-white p-1 shadow-xl">
                  {(Object.keys(NETWORKS) as NetworkId[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { setActiveNetwork(id); setIsNetworkDropdownOpen(false); }}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs hover:bg-neutral-100"
                    >
                      <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />{NETWORKS[id].name}</span>
                      {activeNetwork === id && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {activeNetwork === "stellar-testnet" && (
              <button
                type="button"
                onClick={requestTestnetFaucet}
                disabled={faucetBusy || !user.walletAddress}
                className="flex h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-800 disabled:opacity-50"
              >
                <Droplets size={13} />
                {faucetBusy ? "Funding..." : "Request Testnet USDC / XLM"}
              </button>
            )}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-md hover:bg-neutral-100 text-neutral-600"
            >
              {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div>
              <h1 className="text-base font-bold text-black tracking-tight capitalize">
                {t(`titles.${activeTab}`)}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Search / Command Palette Trigger (#308) */}
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-black/10 hover:border-black/25 bg-neutral-50 hover:bg-neutral-100 text-xs text-neutral-500 transition-colors"
              title="Open Command Palette (⌘K / Ctrl+K)"
              aria-label="Open Command Palette"
            >
              <Search size={14} className="text-neutral-400" />
              <span>Search commands...</span>
              <kbd className="ml-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-white border border-black/10 text-neutral-500 shadow-2xs">
                ⌘K
              </kbd>
            </button>

            <button
              onClick={toggleDrawer}
              className="relative p-2 rounded-lg border border-black/10 hover:border-black/25 bg-white text-neutral-600 hover:text-black transition-colors"
              title={t("notifications")}
              aria-label={t("notifications")}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-600 text-white rounded-full text-[9px] font-bold flex items-center justify-center font-mono">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <label className="inline-flex items-center gap-1"><span className="sr-only">Dashboard color theme</span><select aria-label="Dashboard color theme" value={theme} onChange={e => setTheme(e.target.value as ThemePreference)} className="rounded border border-black/20 bg-white px-2 py-1 text-xs text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label className="flex items-center gap-1 text-xs text-neutral-700 dark:text-neutral-200"><span className="sr-only">Display currency</span><select aria-label="Display currency" value={currency} onChange={(event) => setCurrency(event.target.value as FiatCurrency)} className="rounded-md border border-black/20 bg-white px-2 py-1 text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">{["USD", "EUR", "GBP", "JPY"].map(code => <option key={code} value={code}>{code}</option>)}</select></label>
            <LocaleSwitcher className="hidden sm:inline-flex" />
            <Link
              href={`${DOCS_URL}/checkout/widget`}
              className="button button-secondary text-xs h-8 px-3 flex items-center gap-1"
            >
              <span>{t("sdkDocs")}</span>
              <ArrowUpRight size={12} />
            </Link>
            <button
              onClick={() => setIsReportsWizardOpen(true)}
              className="button button-secondary text-xs h-8 px-3 flex items-center gap-1.5"
              title="Interactive Subscription Analytics & Tax Reporting Wizard (#168)"
            >
              <FileSpreadsheet size={13} className="text-black" />
              <span className="hidden sm:inline">Reports & Taxes</span>
            </button>
            {user.customContractId ? (
              <button
                onClick={() => setIsDeployModalOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-mono hover:bg-emerald-100 transition-colors"
                title={`Active Custom Contract: ${user.customContractId}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Vault: {user.customContractId.slice(0, 4)}...{user.customContractId.slice(-4)}</span>
              </button>
            ) : (
              <button
                onClick={() => setIsDeployModalOpen(true)}
                className="button button-secondary text-xs h-8 px-3 flex items-center gap-1.5"
                title="Deploy custom branded Soroban vault"
              >
                <Sparkles size={13} className="text-black" />
                <span className="hidden sm:inline">Deploy Vault</span>
              </button>
            )}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100 text-neutral-800 border border-black/5 text-xs font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>{t("settlementEngine")}</span>
            </div>
          </div>
        </header>

        {staleWarningVisible && (
          <div role="alert" className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <span className="font-medium">Live sync interrupted. Reconnecting...</span>
            <button
              type="button"
              onClick={reconnectNow}
              className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold"
            >
              Reconnect Now
            </button>
          </div>
        )}

        {walletNetworkWarning && (
          <div role="alert" className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <span>{walletNetworkWarning}</span>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("orbit:open-freighter-network"))}
              className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold"
            >
              Switch Wallet Network
            </button>
          </div>
        )}
        {fiatError && <p role="status" className="px-6 pt-2 text-xs text-amber-800">Fiat exchange rates may be temporarily unavailable; USDC amounts remain authoritative.</p>}
        {/* Tab Content */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-6xl w-full mx-auto">
          {activeTab === "overview" && (
            <OverviewView
              user={user}
              activeNetwork={activeNetwork}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onOpenReportsWizard={() => setIsReportsWizardOpen(true)}
            />
          )}

          {activeTab === "plans" && <PlansView />}

          {activeTab === "subscribers" && <SubscribersView />}
          {activeTab === "retention" && <RetentionView />}

          {activeTab === "templates" && <NotificationTemplatesView />}

          {activeTab === "payroll" && (
            <PayrollView
              autoOpenUpload={payrollAutoUpload}
              onUploadOpened={() => setPayrollAutoUpload(false)}
            />
          )}

          {activeTab === "multisig" && <MultisigView />}

          {activeTab === "passes" && <GiftPassesView />}

          {activeTab === "domains" && <DomainsView />}

          {activeTab === "links" && (
            <PaymentLinksView businessName={user.businessName} />
          )}

          {activeTab === "team" && <TeamView />}

          {activeTab === "tax" && <TaxComplianceView />}

          {activeTab === "developers" && <DevelopersView />}
        </main>
      </div>

      {/* Global Dashboard Command Palette (#308) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
          setIsMobileMenuOpen(false);
        }}
        onOpenCreatePlan={() => setIsCreatePlanOpen(true)}
        onDisbursePayroll={handleDisbursePayroll}
        onCopySettlementAddress={handleCopySettlementAddress}
        user={user}
      />

      {/* Create Plan Modal (#308 Quick Action) */}
      <CreatePlanModal
        isOpen={isCreatePlanOpen}
        onClose={() => setIsCreatePlanOpen(false)}
        onCreatePlan={handleCreatePlan}
      />

      {/* Vault Management Modal */}
      <VaultModal
        isOpen={isVaultModalOpen}
        onClose={() => setIsVaultModalOpen(false)}
        user={user}
        onUpdateVault={updateVault}
      />

      {/* Custom Branded Soroban Vault Deployment Wizard Modal (#143) */}
      <DeployVaultModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
      />

      {/* Interactive Subscription Analytics Export & Tax Reporting Wizard Modal (#168) */}
      <ReportsTaxWizardModal
        isOpen={isReportsWizardOpen}
        onClose={() => setIsReportsWizardOpen(false)}
        merchantId={user.id}
        merchantName={user.businessName}
        walletAddress={user.walletAddress}
      />

      {/* Real-time Notifications Drawer */}
      <NotificationDrawer />

      {/* Toast Notification Pill */}
      {toastNotification && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-xl border text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200 ${
            toastNotification.type === "success"
              ? "bg-black text-white border-black/20"
              : "bg-red-600 text-white border-red-700"
          }`}
        >
          {toastNotification.type === "success" ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <X size={14} className="text-white" />
          )}
          <span>{toastNotification.message}</span>
        </div>
      )}
      <NotificationToasts />
    </div>
  );
}
