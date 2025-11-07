    CREATE INDEX IF NOT EXISTS ad_metrics_user_name_date_ad_idx
      ON public.ad_metrics(user_id, ad_name, date, ad_id);
    ```
  - Para detalhes (join de thumbnail):
    ```sql
    CREATE INDEX IF NOT EXISTS ads_user_adid_idx
      ON public.ads(user_id, ad_id);
    ```

- **Query do ranking (pai, agrupado por `ad_name`)**
  - Dentro do período:
    ```sql
    SELECT
      ad_name,
      COUNT(DISTINCT ad_id)::int AS ad_scale,
      SUM(impressions)::bigint   AS impressions,
      SUM(clicks)::bigint        AS clicks,
      SUM(inline_link_clicks)::bigint AS inline_link_clicks,
      SUM(spend)::numeric        AS spend,
      SUM(video_total_plays)::bigint AS plays
    FROM public.ad_metrics
    WHERE user_id = :uid
      AND date BETWEEN :date_start AND :date_stop
      AND COALESCE(NULLIF(ad_name,''),'') <> ''
    GROUP BY ad_name
    ORDER BY spend DESC
    LIMIT :limit;
    ```
  - Se quiser thumbnail representativa no pai, escolha o `ad_id` com mais `impressions` no período e faça um `LEFT JOIN ads` para pegar `thumbnail_url`.

- **Query dos filhos (detalhes por `ad_id` para um `ad_name`)**
  ```sql
  SELECT
    m.ad_id,
    SUM(m.impressions) AS impressions,
    SUM(m.clicks) AS clicks,
    SUM(m.inline_link_clicks) AS inline_link_clicks,
    SUM(m.spend) AS spend,
    SUM(m.video_total_plays) AS plays,
    a.thumbnail_url,
    a.creative_video_id
  FROM public.ad_metrics m
  LEFT JOIN public.ads a
    ON a.user_id = m.user_id AND a.ad_id = m.ad_id
  WHERE m.user_id = :uid
    AND m.ad_name = :ad_name
    AND m.date BETWEEN :date_start AND :date_stop
  GROUP BY m.ad_id, a.thumbnail_url, a.creative_video_id
  ORDER BY spend DESC;
  ```

- **Contrato de API simples**
  - Pai: já existe `POST /analytics/rankings`. Quando `group_by="ad_name"`, inclua `ad_scale` (count distinct ad_id) e, opcionalmente, `thumbnail` representativa.
  - Filhos: novo endpoint, por exemplo `GET /analytics/rankings/ad-name/{ad_name}/children?date_start&date_stop`, retornando a lista por `ad_id`.

### Frontend: UX eficiente e previsível

- **Tabela principal**: exibir `ad_name` + “N anúncios” (vindo do backend como `ad_scale`) + métricas agregadas. Ordenação por métricas funciona bem neste nível.
- **Expansão lazy**:
  - Ao expandir, chame o endpoint de filhos; mostre skeleton/loading.
  - Liste `ad_id`, `thumbnail`, métricas agregadas do período, e CTA para “ver mais” (ex.: histórico diário, vídeo, link do anúncio).
  - Cache com React Query por chave `['ad-children', ad_name, date_start, date_stop]`.

- **Semântica do contador**:
  - Exiba “N anúncios no período” (e não total histórico), para manter consistência com os números da linha.

### Quando usar materialized view

- Se quiser uma visão “catálogo” global de mapeamento `ad_name -> [ad_ids]` para navegação fora do contexto de datas, crie uma MV derivada de `ads`. Para o ranking filtrado por datas, prefira a contagem dinâmica em `ad_metrics` (é mais correta).

### Armadilhas e como evitar

- **Renomeações de `ad_name`**: se isso for comum, mude a chave de agrupamento para um `asset_key` estável e mostre `ad_name` como label.
- **Payloads grandes**: não envie `ad_ids` no pai — apenas `ad_scale`. Carregue os `ad_ids` nos filhos (lazy).
- **RLS/segurança**: garanta `user_id = auth.uid()` em todas as queries. Os índices propostos mantêm as leituras rápidas com RLS ativo.

Se quiser, eu descrevo exatamente as mudanças no endpoint de rankings para incluir `ad_scale` correto e o contrato do endpoint de filhos. Posso também sugerir o pequeno ajuste no `page.tsx` para o expand/collapse com React Query.