"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import { useMe, useAdAccounts, useAds, useAuthUrl, useAuthToken } from "@/lib/api/hooks";
import { useClientAuth, useClientPacks, useClientAdAccounts } from "@/lib/hooks/useClientSession";
import { showSuccess, showError } from "@/lib/utils/toast";
import { useAuthManager } from "@/lib/hooks/useAuthManager";
import { api } from "@/lib/api/endpoints";

export default function ApiTestPage() {
  const [testParams, setTestParams] = useState({
    adaccount_id: "",
    date_start: "2024-01-01",
    date_stop: "2024-01-31",
    level: "ad" as const,
    limit: 100,
    filters: [],
  });

  // Estado do progresso
  const [jobProgress, setJobProgress] = useState<{
    jobId: string | null;
    status: string;
    progress: number;
    message: string;
    data: any[] | null;
  }>({
    jobId: null,
    status: "idle",
    progress: 0,
    message: "",
    data: null,
  });

  // Store hooks (client-side only)
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { packs, addPack } = useClientPacks();
  const { adAccounts } = useClientAdAccounts();
  const { handleLoginSuccess, handleLogout } = useAuthManager();

  // API hooks
  const { data: me, isLoading: meLoading, error: meError } = useMe();
  const { data: adAccountsData, isLoading: adAccountsLoading, error: adAccountsError } = useAdAccounts();
  const { data: adsData, isLoading: adsLoading, error: adsError, refetch: refetchAds } = useAds(testParams, false); // Desabilitado para execução automática

  // Mutations
  const authUrlMutation = useAuthUrl();
  const authTokenMutation = useAuthToken();

  // Polling do progresso do job
  useEffect(() => {
    if (!jobProgress.jobId || jobProgress.status === "completed" || jobProgress.status === "failed" || jobProgress.status === "error") {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const progress = await api.facebook.getJobProgress(jobProgress.jobId!);
        setJobProgress((prev) => ({
          ...prev,
          status: progress.status,
          progress: progress.progress,
          message: progress.message,
          data: progress.data || prev.data,
        }));

        if (progress.status === "completed" && progress.data) {
          // Criar pack automaticamente quando completar
          const normalized = progress.data as any[];
          const pack = {
            id: `pack_${Date.now()}`,
            name: `Test Pack ${new Date().toLocaleString()}`,
            adaccount_id: testParams.adaccount_id,
            date_start: testParams.date_start,
            date_stop: testParams.date_stop,
            level: testParams.level,
            ads: normalized,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          addPack(pack);
          showSuccess(`Pack criado com ${normalized.length} anúncios!`);
        } else if (progress.status === "failed" || progress.status === "error") {
          showError({ message: progress.message });
        }
      } catch (error) {
        console.error("Error polling job progress:", error);
        setJobProgress((prev) => ({
          ...prev,
          status: "error",
          message: "Erro ao verificar progresso do job",
        }));
      }
    }, 2000); // Poll a cada 2 segundos

    return () => clearInterval(pollInterval);
  }, [jobProgress.jobId, jobProgress.status, testParams, addPack]);

  const handleGetAuthUrl = async () => {
    try {
      const result = await authUrlMutation.mutateAsync();
      if (result.auth_url) {
        // Abrir popup para OAuth
        const popup = window.open(result.auth_url, "facebook-auth", "width=600,height=600,scrollbars=yes,resizable=yes");

        // Escutar mensagem do popup
        const messageListener = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;

          if (event.data.type === "FACEBOOK_AUTH_SUCCESS") {
            const { code } = event.data;
            handleExchangeToken(code);
            popup?.close();
            window.removeEventListener("message", messageListener);
          }
        };

        window.addEventListener("message", messageListener);
      }
    } catch (error) {
      showError(error as any);
    }
  };

  const handleExchangeToken = async (code: string) => {
    try {
      const result = await authTokenMutation.mutateAsync({ code, redirect_uri: window.location.origin + "/callback" });

      // Usar o hook de gerenciamento de auth
      handleLoginSuccess(result.access_token, result.user_info);
    } catch (error) {
      showError(error as any);
    }
  };

  const handleTestAds = async () => {
    if (!testParams.adaccount_id) {
      showError({ message: "Selecione uma conta de anúncios" });
      return;
    }

    try {
      // Resetar estado do progresso
      setJobProgress({
        jobId: null,
        status: "starting",
        progress: 0,
        message: "Iniciando busca de anúncios...",
        data: null,
      });

      // Iniciar job
      const result = await api.facebook.startAdsJob(testParams);

      if (result.job_id) {
        setJobProgress((prev) => ({
          ...prev,
          jobId: result.job_id,
          status: "running",
          message: "Job iniciado com sucesso! Aguardando processamento...",
        }));
      } else {
        showError({ message: "Falha ao iniciar job de busca de anúncios" });
      }
    } catch (error) {
      showError(error as any);
      setJobProgress((prev) => ({
        ...prev,
        status: "error",
        message: "Erro ao iniciar busca de anúncios",
      }));
    }
  };

  // Só renderizar quando estiver no cliente para evitar problemas de hidratação
  if (!isClient) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold">API Test Page</h1>
            <p className="text-muted text-lg">Carregando...</p>
          </div>
          <LoadingState label="Inicializando..." />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">API Test Page</h1>
          <p className="text-muted text-lg">Teste da camada de dados (Axios + TanStack Query + Zustand)</p>
        </div>

        {/* Status de Autenticação */}
        <Card>
          <CardHeader>
            <CardTitle>Status de Autenticação</CardTitle>
            <CardDescription>Estado atual da sessão</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="font-medium">Status:</span>
              <span className={`px-2 py-1 rounded text-sm ${isAuthenticated ? "bg-brand text-white" : "bg-surface2 text-muted"}`}>{isAuthenticated ? "Autenticado" : "Não autenticado"}</span>
            </div>

            {user && (
              <div className="space-y-2">
                <p>
                  <strong>Nome:</strong> {user.name}
                </p>
                <p>
                  <strong>ID:</strong> {user.id}
                </p>
                <p>
                  <strong>Email:</strong> {user.email || "Não informado"}
                </p>
                {user.picture?.data?.url && (
                  <div className="flex items-center gap-2">
                    <strong>Foto:</strong>
                    <img src={user.picture.data.url} alt="Profile" className="w-8 h-8 rounded-full" />
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-4">
              {!isAuthenticated ? (
                <Button onClick={handleGetAuthUrl} disabled={authUrlMutation.isPending}>
                  {authUrlMutation.isPending ? "Carregando..." : "Conectar com Facebook"}
                </Button>
              ) : (
                <Button onClick={handleLogout} variant="destructive">
                  Desconectar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dados do Usuário */}
        <Card>
          <CardHeader>
            <CardTitle>Dados do Usuário (useMe)</CardTitle>
            <CardDescription>Hook useMe do TanStack Query</CardDescription>
          </CardHeader>
          <CardContent>
            {meLoading && <LoadingState label="Carregando dados do usuário..." />}
            {meError && typeof meError === "object" && (meError as any).message && <ErrorState message={(meError as any).message} />}
            {me && !meLoading && typeof me === "object" && (
              <div className="space-y-2">
                <p>
                  <strong>Nome:</strong> {(me as any).name}
                </p>
                <p>
                  <strong>ID:</strong> {(me as any).id}
                </p>
                <p>
                  <strong>Email:</strong> {(me as any).email || "Não informado"}
                </p>
                {(me as any).picture?.data?.url && (
                  <div className="flex items-center gap-2">
                    <strong>Foto:</strong>
                    <img src={(me as any).picture.data.url} alt="Profile" className="w-8 h-8 rounded-full" />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contas de Anúncios */}
        <Card>
          <CardHeader>
            <CardTitle>Contas de Anúncios (useAdAccounts)</CardTitle>
            <CardDescription>Hook useAdAccounts do TanStack Query</CardDescription>
          </CardHeader>
          <CardContent>
            {adAccountsLoading && <LoadingState label="Carregando contas de anúncios..." />}
            {adAccountsError ? <ErrorState message="Erro ao carregar contas de anúncios" /> : null}
            {adAccountsData && !adAccountsLoading && Array.isArray(adAccountsData) ? (
              <div className="space-y-2">
                {adAccountsData.length === 0 ? (
                  <EmptyState message="Nenhuma conta de anúncios encontrada" />
                ) : (
                  <>
                    {adAccountsData.map((account: any) => (
                      <div key={account.id} className="p-3 border border-surface2 rounded">
                        <p>
                          <strong>Nome:</strong> {account.name}
                        </p>
                        <p>
                          <strong>ID:</strong> {account.id}
                        </p>
                        <p>
                          <strong>Status:</strong> {account.account_status === 1 ? "Ativo" : account.account_status === 2 ? "Pausado" : "Com Restrições"}
                        </p>
                        {account.business && (
                          <p>
                            <strong>Business:</strong> {account.business.name}
                          </p>
                        )}
                        {account.instagram_accounts?.data && account.instagram_accounts.data.length > 0 && (
                          <p>
                            <strong>Instagram:</strong> {account.instagram_accounts.data.map((ig: any) => ig.username).join(", ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Teste de Anúncios */}
        <Card>
          <CardHeader>
            <CardTitle>Teste de Anúncios (useAds)</CardTitle>
            <CardDescription>Hook useAds com parâmetros customizados</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Conta de Anúncios</label>
                <select value={testParams.adaccount_id} onChange={(e) => setTestParams((prev) => ({ ...prev, adaccount_id: e.target.value }))} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md">
                  <option value="">Selecione uma conta de anúncios</option>
                  {adAccountsData &&
                    (adAccountsData as any).length > 0 &&
                    (adAccountsData as any).map((account: any) => (
                      <option key={account.id} value={account.id}>
                        {account.name} - {account.id} ({account.account_status === 1 ? "Ativo" : account.account_status === 2 ? "Pausado" : "Com Restrições"})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Nível</label>
                <select value={testParams.level} onChange={(e) => setTestParams((prev) => ({ ...prev, level: e.target.value as any }))} className="w-full h-10 px-3 py-2 border border-surface2 bg-surface text-text rounded-md">
                  <option value="campaign">Campaign</option>
                  <option value="adset">Adset</option>
                  <option value="ad">Ad</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Data Início</label>
                <Input type="date" value={testParams.date_start} onChange={(e) => setTestParams((prev) => ({ ...prev, date_start: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Data Fim</label>
                <Input type="date" value={testParams.date_stop} onChange={(e) => setTestParams((prev) => ({ ...prev, date_stop: e.target.value }))} />
              </div>
            </div>

            <Button onClick={handleTestAds} disabled={jobProgress.status === "running" || jobProgress.status === "starting" || !testParams.adaccount_id}>
              {jobProgress.status === "running" || jobProgress.status === "starting" ? "Buscando anúncios..." : "Buscar Anúncios"}
            </Button>

            {/* Feedback visual do progresso */}
            {(jobProgress.status === "running" || jobProgress.status === "starting") && (
              <div className="mt-4 p-4 bg-surface2 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text">{jobProgress.message}</span>
                  <span className="text-sm text-muted">{jobProgress.progress}%</span>
                </div>
                <Progress value={jobProgress.progress} className="h-2" />
                <p className="text-xs text-muted">⏳ Processando insights da Meta API... Esta operação pode demorar até 5 minutos.</p>
              </div>
            )}

            {/* Status de conclusão */}
            {jobProgress.status === "completed" && jobProgress.data && (
              <div className="mt-4 p-4 bg-green-900/20 border border-green-500/30 rounded-lg">
                <p className="text-sm text-green-400 font-medium">✅ {jobProgress.message}</p>
              </div>
            )}

            {/* Status de erro */}
            {(jobProgress.status === "failed" || jobProgress.status === "error") && (
              <div className="mt-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400 font-medium">❌ {jobProgress.message}</p>
              </div>
            )}

            {adsError && <ErrorState message={adsError.message} />}
            {jobProgress.data && jobProgress.status === "completed" && (
              <div className="space-y-2">
                {!jobProgress.data || jobProgress.data.length === 0 ? (
                  <EmptyState message="Nenhum anúncio encontrado" />
                ) : (
                  <>
                    <p>
                      <strong>Total de anúncios:</strong> {jobProgress.data.length}
                    </p>
                    {jobProgress.data.slice(0, 3).map((ad: any, idx: number) => (
                      <div key={ad?.ad_id || ad?.id || idx} className="p-4 border border-surface2 rounded-lg space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-lg">Anúncio #{idx + 1}</h4>
                          <span className="text-xs text-muted bg-surface2 px-2 py-1 rounded">
                            {Object.keys(ad || {}).length} campos • {Object.keys(ad || {}).filter((key) => ["ad_name", "ad_id", "adset_id", "adset_name", "campaign_id", "campaign_name", "clicks", "impressions", "inline_link_clicks", "spend", "ctr", "cpm", "reach", "frequency", "website_ctr", "actions", "conversions", "cost_per_conversion", "video_play_actions", "video_thruplay_watched_actions", "video_p50_watched_actions", "video_play_curve_actions", "creative", "adcreatives_videos_ids", "account_id", "date_start", "date_stop"].includes(key)).length} principais
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                          {/* Campos principais */}
                          <div className="space-y-2">
                            <p>
                              <strong>Nome:</strong> {ad?.name ?? ad?.ad_name ?? "—"}
                            </p>
                            <p>
                              <strong>ID:</strong> {ad?.id ?? ad?.ad_id ?? "—"}
                            </p>
                            <p>
                              <strong>Status:</strong> {ad?.status ?? ad?.effective_status ?? "—"}
                            </p>
                            <p>
                              <strong>Campaign ID:</strong> {ad?.campaign_id ?? "—"}
                            </p>
                            <p>
                              <strong>Campaign Name:</strong> {ad?.campaign_name ?? "—"}
                            </p>
                            <p>
                              <strong>Adset ID:</strong> {ad?.adset_id ?? "—"}
                            </p>
                            <p>
                              <strong>Adset Name:</strong> {ad?.adset_name ?? "—"}
                            </p>
                            <p>
                              <strong>Account ID:</strong> {ad?.account_id ?? "—"}
                            </p>
                            <p>
                              <strong>Date Start:</strong> {ad?.date_start ?? "—"}
                            </p>
                            <p>
                              <strong>Date Stop:</strong> {ad?.date_stop ?? "—"}
                            </p>
                          </div>

                          {/* Métricas básicas */}
                          <div className="space-y-2">
                            <p>
                              <strong>Impressions:</strong> {ad?.impressions ?? "—"}
                            </p>
                            <p>
                              <strong>Clicks:</strong> {ad?.clicks ?? "—"}
                            </p>
                            <p>
                              <strong>Inline Link Clicks:</strong> {Array.isArray(ad?.inline_link_clicks) ? ad.inline_link_clicks[0]?.value ?? "—" : ad?.inline_link_clicks ?? "—"}
                            </p>
                            <p>
                              <strong>Spend:</strong> {ad?.spend ?? "—"}
                            </p>
                            <p>
                              <strong>CTR:</strong> {ad?.ctr ?? "—"}
                            </p>
                            <p>
                              <strong>CPM:</strong> {ad?.cpm ?? "—"}
                            </p>
                            <p>
                              <strong>Reach:</strong> {ad?.reach ?? "—"}
                            </p>
                            <p>
                              <strong>Frequency:</strong> {ad?.frequency ?? "—"}
                            </p>
                            <p>
                              <strong>Website CTR:</strong> {Array.isArray(ad?.website_ctr) ? ad.website_ctr[0]?.value ?? "—" : ad?.website_ctr ?? "—"}
                            </p>
                          </div>

                          {/* Métricas de vídeo */}
                          <div className="space-y-2">
                            <p>
                              <strong>Video Plays:</strong> {ad?.video_play_actions?.[0]?.value ?? "—"}
                            </p>
                            <p>
                              <strong>Video Thruplays:</strong> {ad?.video_thruplay_watched_actions?.[0]?.value ?? "—"}
                            </p>
                            <p>
                              <strong>Video P50:</strong> {ad?.video_p50_watched_actions?.[0]?.value ?? "—"}
                            </p>
                            <p>
                              <strong>Conversions:</strong> {ad?.conversions ? (Array.isArray(ad.conversions) ? ad.conversions.length + " items" : JSON.stringify(ad.conversions)) : "—"}
                            </p>
                            <p>
                              <strong>Cost per Conversion:</strong> {ad?.cost_per_conversion ? (Array.isArray(ad.cost_per_conversion) ? ad.cost_per_conversion.length + " items" : JSON.stringify(ad.cost_per_conversion)) : "—"}
                            </p>
                            <p>
                              <strong>Creative:</strong> {ad?.creative ? "Presente" : "—"}
                            </p>
                            <p>
                              <strong>Videos:</strong> {ad?.adcreatives_videos_ids?.length ?? 0} vídeos
                            </p>
                            <p>
                              <strong>Play Curve:</strong> {ad?.video_play_curve_actions?.[0]?.value?.length ?? 0} pontos
                            </p>
                          </div>
                        </div>

                        {/* Actions & Conversions */}
                        {(ad?.actions || ad?.conversions || ad?.cost_per_conversion) && (
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                            {ad?.actions && Array.isArray(ad.actions) && (
                              <div>
                                <p className="font-medium text-sm mb-2">Actions:</p>
                                <div className="bg-surface2 p-2 rounded text-xs">
                                  <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(ad.actions, null, 2)}</pre>
                                </div>
                              </div>
                            )}
                            {ad?.conversions && (
                              <div>
                                <p className="font-medium text-sm mb-2">Conversions:</p>
                                <div className="bg-surface2 p-2 rounded text-xs">
                                  <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(ad.conversions, null, 2)}</pre>
                                </div>
                              </div>
                            )}
                            {ad?.cost_per_conversion && (
                              <div>
                                <p className="font-medium text-sm mb-2">Cost per conversion:</p>
                                <div className="bg-surface2 p-2 rounded text-xs">
                                  <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(ad.cost_per_conversion, null, 2)}</pre>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Creative info + videos */}
                        {(ad?.creative || ad?.adcreatives_videos_ids || ad?.adcreatives_videos_thumbs) && (
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            {ad?.creative && (
                              <div>
                                <p className="font-medium text-sm mb-2">Creative:</p>
                                <div className="bg-surface2 p-2 rounded text-xs">
                                  <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify(ad.creative, null, 2)}</pre>
                                </div>
                              </div>
                            )}
                            {(ad?.adcreatives_videos_ids || ad?.adcreatives_videos_thumbs) && (
                              <div>
                                <p className="font-medium text-sm mb-2">Vídeos (adcreatives):</p>
                                <div className="bg-surface2 p-2 rounded text-xs">
                                  <pre className="whitespace-pre-wrap overflow-x-auto">{JSON.stringify({ ids: ad?.adcreatives_videos_ids, thumbs: ad?.adcreatives_videos_thumbs }, null, 2)}</pre>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Todos os campos (debug) */}
                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-text">Ver todos os campos (debug)</summary>
                          <div className="mt-2 bg-surface2 p-3 rounded text-xs">
                            <pre className="whitespace-pre-wrap overflow-x-auto max-h-40">{JSON.stringify(ad, null, 2)}</pre>
                          </div>
                        </details>
                      </div>
                    ))}
                    {jobProgress.data.length > 3 && <p className="text-muted">... e mais {jobProgress.data.length - 3} anúncios</p>}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Packs Salvos */}
        <Card>
          <CardHeader>
            <CardTitle>Packs Salvos (Zustand Store)</CardTitle>
            <CardDescription>Estado global dos packs de anúncios</CardDescription>
          </CardHeader>
          <CardContent>
            {packs.length === 0 ? (
              <EmptyState message="Nenhum pack salvo" />
            ) : (
              <div className="space-y-4">
                {packs.map((pack) => (
                  <div key={pack.id} className="p-4 border border-surface2 rounded">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{pack.name}</h3>
                        <p className="text-sm text-muted">
                          {pack.ads.length} anúncios • {pack.level} • {pack.date_start} a {pack.date_stop}
                        </p>
                      </div>
                      <Button size="sm" variant="destructive">
                        Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
