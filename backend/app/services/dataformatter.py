from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from typing import Dict, List, Any

def split_date_range(date_range: Dict[str, str], max_days: int = 7) -> List[Dict[str, str]]:
    start_date = datetime.strptime(date_range["since"], "%Y-%m-%d")
    end_date = datetime.strptime(date_range["until"], "%Y-%m-%d")
    if start_date == end_date:
        return [date_range]
    chunks: List[Dict[str, str]] = []
    current = start_date
    while current < end_date:
        chunk_end = min(current + timedelta(days=max_days - 1), end_date)
        chunks.append({"since": current.strftime("%Y-%m-%d"), "until": chunk_end.strftime("%Y-%m-%d")})
        current = chunk_end + timedelta(days=1)
    return chunks

def expand_conversions(row: pd.Series, columns: List[str]) -> pd.Series:
    for column in columns:
        if isinstance(row[column], list):
            for conversion in row[column]:
                col_name = f"""{column}.{conversion.get("action_type")}"""
                row[col_name] = pd.to_numeric(conversion.get("value", 0), errors="coerce")
        elif isinstance(row[column], dict):
            for key, value in row[column].items():
                col_name = f"{column}.{key}"
                row[col_name] = pd.to_numeric(value, errors="coerce") if isinstance(value, (int, float)) else value
    return row

def format_ads_data(json_data: List[Dict[str, Any]]) -> pd.DataFrame:
    df = pd.DataFrame(json_data)

    # Strings
    for col in ["ad_name","adset_name","campaign_name","ad_id","adset_id","campaign_id"]:
        if col in df:
            df[col] = df[col].astype(str)

    # Integers
    for col in ["clicks","impressions","inline_link_clicks","reach"]:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce", downcast="integer").fillna(0)

    # Floats
    for col in ["cpm","ctr","frequency","spend"]:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce", downcast="float").fillna(0)

    # Play curve actions → lista de ints em video_play_curve_actions
    if "video_play_curve_actions" in df:
        play_curve_actions = df["video_play_curve_actions"].apply(
            lambda x: x[0]["value"] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and "value" in x[0] else [0] * 22
        )
        curve_cols = [f"retention_at_{i}" for i in range(15)] + [
            "retention_at_15to20","retention_at_20to25","retention_at_25to30",
            "retention_at_30to40","retention_at_40to50","retention_at_50to60","retention_over_60"
        ]
        df_curve = pd.DataFrame(play_curve_actions.tolist(), columns=curve_cols)
        df_curve = df_curve.apply(lambda x: pd.to_numeric(x, downcast="integer", errors="coerce"))
        df["video_play_curve_actions"] = df_curve.values.tolist()

    # Total plays / thruplays / website ctr
    if "video_play_actions" in df:
        df_total_plays = pd.DataFrame(df["video_play_actions"].apply(
            lambda x: x[0]["value"] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and "value" in x[0] else 0
        ))
        df_total_plays.rename(columns={"video_play_actions": "total_plays"}, inplace=True)
        df_total_plays["total_plays"] = pd.to_numeric(df_total_plays["total_plays"], errors="coerce", downcast="integer").fillna(0)
    else:
        df_total_plays = pd.DataFrame({"total_plays": [0] * len(df)})

    if "video_p50_watched_actions" in df:
        df_p50 = pd.DataFrame(df["video_p50_watched_actions"].apply(
            lambda x: x[0]["value"] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and "value" in x[0] else 0
        ))
        df_p50.rename(columns={"video_p50_watched_actions": "video_watched_p50"}, inplace=True)
        df_p50["video_watched_p50"] = pd.to_numeric(df_p50["video_watched_p50"], errors="coerce", downcast="integer").fillna(0)
    else:
        df_p50 = pd.DataFrame({"video_watched_p50": [0] * len(df)})

    if "video_thruplay_watched_actions" in df:
        df_thru = pd.DataFrame(df["video_thruplay_watched_actions"].apply(
            lambda x: x[0]["value"] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and "value" in x[0] else 0
        ))
        df_thru.rename(columns={"video_thruplay_watched_actions": "total_thruplays"}, inplace=True)
        df_thru["total_thruplays"] = pd.to_numeric(df_thru["total_thruplays"], errors="coerce", downcast="integer").fillna(0)
    else:
        df_thru = pd.DataFrame({"total_thruplays": [0] * len(df)})

    if "website_ctr" in df:
        df_wctr = pd.DataFrame(df["website_ctr"].apply(
            lambda x: x[0]["value"] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and "value" in x[0] else 0.0
        ))
        df_wctr["website_ctr"] = pd.to_numeric(df_wctr["website_ctr"], errors="coerce", downcast="float").fillna(0)
    else:
        df_wctr = pd.DataFrame({"website_ctr": [0.0] * len(df)})

    # Concatenar colunas derivadas
    drop_cols = [c for c in ["video_play_actions","video_thruplay_watched_actions","website_ctr","video_p50_watched_actions"] if c in df]
    df = df.drop(columns=drop_cols)
    df = pd.concat([df, df_total_plays, df_p50, df_thru, df_wctr], axis=1)

    # Explodir actions/conversions/creative em colunas planas
    for col in ["actions","conversions","cost_per_conversion","creative"]:
        if col in df:
            df = df.apply(lambda row: expand_conversions(row, [col]), axis=1)
            df = df.drop(columns=[col])

    # Métricas calculadas
    if "inline_link_clicks" in df and "actions.landing_page_view" in df:
        df["connect_rate"] = df.apply(
            lambda row: (row["actions.landing_page_view"] / row["inline_link_clicks"]) if row["inline_link_clicks"] != 0 else np.nan,
            axis=1
        )
        df["connect_rate"] = pd.to_numeric(df["connect_rate"], errors="coerce", downcast="float")

    if "ctr" in df and "website_ctr" in df:
        df["profile_ctr"] = df["ctr"] - df["website_ctr"]

    if "spend" in df:
        if "actions.purchase" in df:  # opcional, depende dos campos retornados
            df["cost_per_conversion.purchase"] = df["spend"] / df["actions.purchase"]
        if "actions.initiate_checkout" in df:
            df["cost_per_conversion.initiate_checkout"] = df["spend"] / df["actions.initiate_checkout"]
        if "actions.purchase" in df:
            df["conversions.purchase"] = df["actions.purchase"]
        if "actions.initiate_checkout" in df:
            df["conversions.initiate_checkout"] = df["actions.initiate_checkout"]

    if "video_watched_p50" in df and "total_plays" in df:
        df["video_watched_p50"] = (df["video_watched_p50"] / df["total_plays"]) * 100
        df["video_watched_p50"] = df["video_watched_p50"].replace([np.inf, -np.inf], 0)

    # Preencher NaN em colunas que não são de custo/conect rate
    cols_to_fill = [c for c in df.columns if not c.startswith("cost_per_") and not c.startswith("connect_rate")]
    df[cols_to_fill] = df[cols_to_fill].fillna(0)

    return df.copy()

def create_agg_rules(df: pd.DataFrame):
    aggs = {}
    type_first = ['ad_name', 'account_id', 'creative.actor_id', 'creative.thumbnail_url', 'creative.video_id', 'creative.body', 'creative.call_to_action_type', 'creative.instagram_permalink_url', 'creative.object_type', 'creative.status', 'creative.title']
    type_sum = ['clicks', 'impressions', 'inline_link_clicks', 'reach', 'spend', 'total_plays', 'total_thruplays']
    type_unique_list = ['ad_id', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name']
    type_agg_unique_list = ['adcreatives_videos_ids', 'adcreatives_videos_thumbs']

    for col in df.columns:
        if col.startswith('actions.') or col.startswith('conversions.'):
            aggs[col] = 'sum'
        elif col.startswith('cost_per_'):
            conv_col = 'conversions.' + col[len('cost_per_conversion.'):]
            if conv_col in df.columns:
                aggs[col] = lambda x, conv_col=conv_col: (
                    (df.loc[x.index, 'spend'].sum() / df.loc[x.index, conv_col].sum())
                    if df.loc[x.index, 'spend'].sum() != 0 and df.loc[x.index, conv_col].sum() != 0 else 0
                )
        elif col.startswith('retention_') or col == 'video_watched_p50':
            aggs[col] = lambda x: np.average(x, weights=df.loc[x.index, 'total_plays']) if df.loc[x.index, 'total_plays'].sum() != 0 else 0
        elif col == 'video_play_curve_actions':
            aggs[col] = lambda x: np.average(x.tolist(), axis=0, weights=df.loc[x.index, 'total_plays']) if df.loc[x.index, 'total_plays'].sum() != 0 else 0
        elif col == 'ctr':
            aggs[col] = lambda x: df.loc[x.index, 'clicks'].sum() / df.loc[x.index, 'impressions'].sum() * 100
        elif col == 'cpm':
            aggs[col] = lambda x: df.loc[x.index, 'spend'].sum() * 1000 / df.loc[x.index, 'impressions'].sum()
        elif col == 'frequency':
            aggs[col] = lambda x: df.loc[x.index, 'impressions'].sum() / df.loc[x.index, 'reach'].sum()
        elif col == 'website_ctr':
            aggs[col] = lambda x: df.loc[x.index, 'inline_link_clicks'].sum() / df.loc[x.index, 'impressions'].sum() * 100
        elif col == 'profile_ctr':
            aggs[col] = lambda x: (df.loc[x.index, 'clicks'].sum() - df.loc[x.index, 'inline_link_clicks'].sum()) / df.loc[x.index, 'impressions'].sum() * 100
        elif col == 'connect_rate':
            aggs[col] = lambda x: df.loc[x.index, 'actions.landing_page_view'].sum() / df.loc[x.index, 'inline_link_clicks'].sum() * 100
        elif col in type_first:
            aggs[col] = 'first'
        elif col in type_sum:
            aggs[col] = 'sum'
        elif col in type_unique_list:
            aggs[col] = lambda x: list(set(x))
        elif col in type_agg_unique_list:
            aggs[col] = lambda x: list(set([item for sublist in x for item in sublist]))
    return aggs

def aggregate_dataframe(df: pd.DataFrame, group_by: str) -> pd.DataFrame:
    if group_by not in df.columns:
        raise KeyError(f"The column '{group_by}' does not exist in the DataFrame.")
    aggs = create_agg_rules(df)
    grouped = df.groupby(group_by).agg(aggs).reset_index(drop=True)
    return grouped

# ========================= NEW API FORMATTER ========================= #
def _to_number(value: Any, default: float = 0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        return float(str(value))
    except Exception:
        return default

def _first_value_from_array(arr: Any) -> float:
    if isinstance(arr, list) and len(arr) > 0:
        first = arr[0]
        if isinstance(first, dict) and "value" in first:
            return _to_number(first.get("value"), 0)
        return _to_number(first, 0)
    return 0.0

def _normalize_actions(actions: Any) -> List[Dict[str, Any]]:
    if not isinstance(actions, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in actions:
        if not isinstance(item, dict):
            continue
        action_type = item.get("action_type")
        value = _to_number(item.get("value"), 0)
        if action_type is not None:
            normalized.append({"action_type": str(action_type), "value": value})
    return normalized

def _normalize_curve(curve: Any) -> List[float]:
    # Esperado: [{ action_type: str, value: number[] }]
    if isinstance(curve, list) and len(curve) > 0 and isinstance(curve[0], dict) and "value" in curve[0]:
        # Garantir que os valores são números
        value_list = curve[0].get("value", [])
        if isinstance(value_list, list):
            return [ _to_number(v, 0) for v in value_list ]
        return []
    # Se vier como lista crua de números, usar diretamente
    if isinstance(curve, list) and (len(curve) == 0 or isinstance(curve[0], (int, float))):
        return [ _to_number(v, 0) for v in curve ]
    return []

def format_ads_for_api(json_data: List[Dict[str, Any]], account_id: str) -> List[Dict[str, Any]]:
    """Converte os registros brutos da Meta API para o formato do FormattedAdSchema (frontend).

    Mantém estruturas nested (ex.: creative) e arrays (actions, conversions, cost_per_conversion).
    Calcula e renomeia métricas derivadas, garantindo tipos numéricos corretos.
    """
    formatted: List[Dict[str, Any]] = []

    for ad in json_data or []:
        safe = lambda k, d=None: ad.get(k, d)

        # Métricas base
        spend = _to_number(safe("spend", 0))
        cpm = _to_number(safe("cpm", 0))
        impressions = int(_to_number(safe("impressions", 0)))
        reach = int(_to_number(safe("reach", 0)))
        frequency = _to_number(safe("frequency", 0))
        clicks = int(_to_number(safe("clicks", 0)))
        inline_link_clicks = int(_to_number(safe("inline_link_clicks", 0)))
        ctr = _to_number(safe("ctr", 0)) / 100
        website_ctr = _first_value_from_array(safe("website_ctr", [])) / 100

        # Vídeo e curva
        total_plays = int(_first_value_from_array(safe("video_play_actions", [])))
        total_thruplays = int(_first_value_from_array(safe("video_thruplay_watched_actions", [])))
        p50 = int(_first_value_from_array(safe("video_p50_watched_actions", [])))
        # percentual assistido até 50% (inteiro)
        video_watched_p50 = int(round((p50 / total_plays) * 100)) if total_plays else 0
        curve = _normalize_curve(safe("video_play_curve_actions", []))

        # Actions / Conversions
        actions = _normalize_actions(safe("actions", []))
        conversions = _normalize_actions(safe("conversions", []))
        cost_per_conversion = _normalize_actions(safe("cost_per_conversion", []))

        # Derivadas
        lpv = 0.0
        for a in actions:
            if a.get("action_type") == "landing_page_view":
                lpv = _to_number(a.get("value"), 0)
                break
        connect_rate = (lpv / inline_link_clicks) if inline_link_clicks else 0.0
        profile_ctr = (ctr - website_ctr if website_ctr else ctr)

        # Creative e videos (já enriquecidos em graph_api)
        creative = safe("creative") or {}
        adcreatives_videos_ids = safe("adcreatives_videos_ids") or []
        adcreatives_videos_thumbs = safe("adcreatives_videos_thumbs") or []

        # Data diária do insight (com time_increment=1, start == stop)
        day = str(safe("date_start", "")) or str(safe("date_stop", ""))

        # Montagem final
        formatted.append({
            # Identificadores
            "account_id": str(account_id),
            "ad_id": str(safe("ad_id", "")),
            "ad_name": str(safe("ad_name", "")),
            "adset_id": str(safe("adset_id", "")),
            "adset_name": str(safe("adset_name", "")),
            "campaign_id": str(safe("campaign_id", "")),
            "campaign_name": str(safe("campaign_name", "")),

            # Métricas inteiras
            "clicks": clicks,
            "impressions": impressions,
            "inline_link_clicks": inline_link_clicks,
            "reach": reach,
            "video_total_plays": total_plays,
            "video_total_thruplays": total_thruplays,
            "video_watched_p50": video_watched_p50,

            # Métricas float
            "spend": spend,
            "cpm": cpm,
            "ctr": ctr,
            "frequency": frequency,
            "website_ctr": website_ctr,

            # Arrays
            "actions": actions,
            "conversions": conversions if conversions else None,
            "cost_per_conversion": cost_per_conversion if cost_per_conversion else None,
            "video_play_curve_actions": curve,

            # Creative
            "creative": creative or {},

            # Videos associados
            "adcreatives_videos_ids": [str(v) for v in adcreatives_videos_ids if v],
            "adcreatives_videos_thumbs": [str(v) for v in adcreatives_videos_thumbs if v],

            # Derivadas
            "connect_rate": connect_rate,
            "profile_ctr": profile_ctr,

            # Data do registro (útil para agrupamentos no frontend)
            "date": day,
        })

    return formatted