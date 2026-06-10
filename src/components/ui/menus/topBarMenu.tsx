"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { LogOutIcon, Moon, Sun } from "lucide-react"
import { signOut } from "next-auth/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from "@/locales/config";
import { getFeedbackConfigCached } from "@/lib/feedbackConfigClient";
import { getRuntimeHealthCached, type RuntimeHealthResponse } from "@/lib/runtimeHealthClient";


const baseLanguages: { label: string; value: string }[] = SUPPORTED_LANGUAGES.map((code) => ({ label: LANGUAGE_LABELS[code], value: code }));

export default function TopBar() {
	const DEV_DIAGNOSTICS = process.env.NODE_ENV === "development";
	const isAuthStatus = (status: number) => status === 401 || status === 403;
	const theme = useSettingsStore((s) => s.theme);
	const dark = useSettingsStore((s) => s.darkMode);
	const setDark = useSettingsStore((s) => s.setDarkMode);
	const language = useSettingsStore((s) => s.language);
	const setLanguage = useSettingsStore((s) => s.setLanguage);

	const { t } = useTranslation("common");

	const [botsByLang, setBotsByLang] = useState<Record<string, boolean>>({});
		const [botLangs, setBotLangs] = useState<string[]>([]);
	const [canViewFeedbackAdmin, setCanViewFeedbackAdmin] = useState(false);
	const [serviceHealth, setServiceHealth] = useState<RuntimeHealthResponse | null>(null);
	const [serviceHealthError, setServiceHealthError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
			fetch('/api/rasa/bots')
			.then((response) => {
				if (response.ok) return response.json();
				if (isAuthStatus(response.status)) return { bots: [] as { lang: string }[] };
				throw new Error(`Failed to fetch bots (${response.status})`);
			})
				.then((data: { bots: { lang: string }[] }) => {
				if (cancelled) return;
				const map: Record<string, boolean> = {};
					const langs: string[] = [];
					for (const b of data.bots || []) { map[b.lang] = true; langs.push(b.lang); }
				setBotsByLang(map);
					setBotLangs(langs);
			})
			.catch((error) => {
				if (!(error instanceof Error && /\(401\)|\(403\)/.test(error.message))) {
					console.error('Failed to fetch bots:', error);
				}
				setBotsByLang({});
			});
		return () => { cancelled = true };
	}, []);

	useEffect(() => {
		let cancelled = false;

		getFeedbackConfigCached()
			.then((data: { canViewAdmin?: boolean; adminEnabled?: boolean }) => {
				if (cancelled) return;
				setCanViewFeedbackAdmin(data.canViewAdmin === true && data.adminEnabled === true);
			})
			.catch((error) => {
				if (!cancelled) {
					if (!(error instanceof Error && /\(401\)|\(403\)/.test(error.message))) {
						console.error('Failed to fetch feedback config:', error);
					}
					setCanViewFeedbackAdmin(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		const load = async (forceRefresh = false) => {
			try {
				const data = await getRuntimeHealthCached(forceRefresh);
				if (cancelled) return;
				setServiceHealth(data);
				setServiceHealthError(null);
			} catch (error) {
				if (cancelled) return;
				setServiceHealthError(error instanceof Error ? error.message : String(error));
			}
		};

		void load(true);
		const intervalId = setInterval(() => {
			void load(true);
		}, 20000);

		return () => {
			cancelled = true;
			clearInterval(intervalId);
		};
	}, []);

	const showDiagnostics = !!serviceHealth || !!serviceHealthError || DEV_DIAGNOSTICS || canViewFeedbackAdmin;

	const healthBadgeClass = (() => {
		if (!serviceHealth) return "border-slate-500 text-slate-700 dark:text-slate-200";
		switch (serviceHealth.overall) {
			case "up":
				return "border-emerald-500 text-emerald-700 dark:text-emerald-300";
			case "degraded":
				return "border-amber-500 text-amber-700 dark:text-amber-300";
			case "down":
			case "misconfigured":
				return "border-rose-500 text-rose-700 dark:text-rose-300";
			default:
				return "border-slate-500 text-slate-700 dark:text-slate-200";
		}
	})();

	const healthBadgeLabel = (() => {
		if (serviceHealthError) return "Runtime ?";
		if (!serviceHealth) return "Runtime ...";
		if (serviceHealth.overall === "up") return "Runtime up";
		if (serviceHealth.overall === "degraded") return "Runtime degraded";
		if (serviceHealth.overall === "down" || serviceHealth.overall === "misconfigured") return "Runtime down";
		return "Runtime unknown";
	})();

	const healthTooltipTitle = serviceHealth?.visibility === "full"
		? "Runtime diagnostics"
		: "Runtime status";

	const renderStatusClass = (status: string) => {
		switch (status) {
			case "up":
			case "ok":
				return "text-emerald-300";
			case "degraded":
			case "warning":
				return "text-amber-300";
			case "down":
			case "misconfigured":
			case "error":
				return "text-rose-300";
			default:
				return "text-slate-200";
		}
	};

	useEffect(() => {
		if (theme && theme !== "default") { 
			document.documentElement.setAttribute("data-theme", theme);
		} else {
			document.documentElement.removeAttribute("data-theme");
		}
		if (typeof document !== 'undefined') {
			document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
		}
	}, [theme]);

	useEffect(() => {
		if (dark) document.documentElement.classList.add("dark");
		else document.documentElement.classList.remove("dark");
		if (typeof document !== 'undefined') {
			document.cookie = `dark=${dark}; path=/; max-age=31536000; samesite=lax`;
		}
	}, [dark]);

	useEffect(() => {
		if (i18n.language !== language) i18n.changeLanguage(language);
		if (typeof document !== 'undefined') {
			document.documentElement.lang = language;
			document.cookie = `lang=${language}; path=/; max-age=31536000; samesite=lax`;
		}
	}, [language]);

	return (
		<div
			className="w-full flex items-center justify-between px-4 py-4 border-b h-auto min-h-0 flex-shrink-0 z-10 bg-background"
			id="sym:TopBar"
		>
			<div className="flex items-center gap-2 h-10">
				<Image 
					src={dark ? "RESQ+_Logo_White_Yellow-Cross_RGB.svg" : "RESQ+_Logo_Full_Colors_RGB.svg"} 
					alt={t('topbar.logoAlt')} 
					width={629} 
					height={179}
					priority
					style={{ height: "200%", width: "auto" }} 
				/>
			</div>
			<div className="flex items-center gap-4 ">
				{showDiagnostics ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge variant="outline" className={healthBadgeClass}>
									{healthBadgeLabel}
								</Badge>
							</TooltipTrigger>
							<TooltipContent side="bottom" align="end" className="max-w-[560px] p-3 space-y-3">
								<div className="font-semibold">{healthTooltipTitle}</div>
								{serviceHealthError ? <div>Health check failed: {serviceHealthError}</div> : null}
								{serviceHealth ? (
									<>
										<div className="opacity-90 text-xs">Checked: {new Date(serviceHealth.checkedAt).toLocaleTimeString()}</div>
										<div className="space-y-1">
											<div className="font-medium text-xs uppercase tracking-wide opacity-90">Core services</div>
											{serviceHealth.services.map((svc) => (
												<div key={svc.key} className="rounded border border-white/15 px-2 py-1.5">
													<div className="flex items-center justify-between gap-3 text-xs">
														<span className="font-medium">{svc.label}</span>
														<span className={renderStatusClass(svc.status)}>{svc.status}</span>
													</div>
													<div className="text-[11px] opacity-90 mt-1 break-words">
														{svc.httpStatus ? `HTTP ${svc.httpStatus} · ` : ""}
														{svc.latencyMs ? `${svc.latencyMs}ms · ` : ""}
														{svc.detail}
													</div>
												</div>
											))}
										</div>
										{serviceHealth.external.length > 0 ? (
											<div className="space-y-1 pt-1 border-t border-white/20">
												<div className="font-medium text-xs uppercase tracking-wide opacity-90">External endpoints</div>
												{serviceHealth.external.map((ext) => (
													<div key={ext.key} className="rounded border border-white/15 px-2 py-1.5">
														<div className="flex items-center justify-between gap-3 text-xs">
															<span className="font-medium">{ext.label}</span>
															<span className={renderStatusClass(ext.status)}>{ext.status}</span>
														</div>
														<div className="text-[11px] opacity-90 mt-1 break-words">
															{ext.httpStatus ? `HTTP ${ext.httpStatus} · ` : ""}
															{ext.latencyMs ? `${ext.latencyMs}ms · ` : ""}
															{ext.detail}
														</div>
													</div>
												))}
											</div>
										) : null}
										{serviceHealth.visibility === "full" && serviceHealth.config.length > 0 ? (
											<div className="space-y-1 pt-1 border-t border-white/20">
												<div className="font-medium text-xs uppercase tracking-wide opacity-90">Config checks</div>
												{serviceHealth.config.map((cfg) => (
													<div key={cfg.key} className="rounded border border-white/15 px-2 py-1.5">
														<div className="flex items-center justify-between gap-3 text-xs">
															<span className="font-medium">{cfg.key}</span>
															<span className={renderStatusClass(cfg.status)}>{cfg.status}</span>
														</div>
														<div className="text-[11px] opacity-90 mt-1 break-words">{cfg.detail}</div>
													</div>
												))}
											</div>
										) : null}
									</>
								) : (
									<div>Collecting runtime diagnostics...</div>
								)}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : null}
				{canViewFeedbackAdmin ? (
					<Button variant="outline" className="rounded  hover:bg-black/5" asChild>
						<Link href="/admin/feedback">Feedback Admin</Link>
					</Button>
				) : null}
				{/* Language selector */}
				<Select value={language} onValueChange={(v) => setLanguage(v)}>
					<SelectTrigger className="w-fit shadow-none hover:bg-black/5" aria-label={t("topbar.language")}>
						<SelectValue placeholder={t("topbar.language")} />
					</SelectTrigger>
					<SelectContent>
						{(() => {
							const merged: { label: string; value: string }[] = [...baseLanguages];
							for (const tag of botLangs) {
								const exists = merged.some((x) => x.value === tag || x.value === tag.split('-')[0]);
								if (!exists) merged.push({ label: tag.toUpperCase(), value: tag });
							}
							return merged.map((l) => {
							const code = String(l.value).toUpperCase();
							const uiAvailable = true;
							const hasBot = !!botsByLang[l.value];

							let suffix = '';
							if (hasBot && uiAvailable) suffix = '';
							else if (hasBot && !uiAvailable) suffix = ` (${t('topbar.flag.rasaShort')})`;
							else if (!hasBot && uiAvailable) suffix = ` (${t('topbar.flag.uiShort')})`;

							return (
								<SelectItem key={l.value} value={l.value} className="">
									<span className="inline-flex items-center justify-between w-full gap-2 data-[highlighted]:text-white">
										<span>{l.label}</span>
										<span className="text-xs text-muted-foreground whitespace-nowrap">{code}{suffix}</span>
									</span>
								</SelectItem>
							)
							})
						})()}
					</SelectContent>
				</Select>
				
				<Button variant="ghost" className="border rounded hover:bg-black/75 dark:hover:bg-white hover:text-white transition-colors dark:hover:text-black" onClick={() => setDark(!dark)} aria-label={t('topbar.toggleDarkMode')}>
					{dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
				</Button>
				<Button variant="ghost" className="border rounded hover:bg-destructive hover:text-white transition-colors" onClick={() => signOut()} aria-label={t('topbar.logout')}>
					<LogOutIcon className="w-4 h-4" />
					{t( "topbar.logout")}
				</Button>
			</div>
		</div>
	);
}
