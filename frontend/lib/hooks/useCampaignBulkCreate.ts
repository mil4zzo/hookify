"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api/endpoints"
import { pollJob } from "@/lib/utils/pollJob"
import { useActiveJobsStore } from "@/lib/store/activeJobs"
import type { CampaignBulkConfig, CampaignBulkProgressResponse } from "@/lib/api/schemas"

interface UseCampaignBulkCreateReturn {
  isStarting: boolean   // true durante o upload dos arquivos, antes do job_id existir
  isCreating: boolean
  jobId: string | null
  progress: CampaignBulkProgressResponse | null
  startCampaignBulk: (files: File[], config: CampaignBulkConfig) => Promise<string | null>
  retryCampaignFailed: (currentJobId: string, itemIds: string[]) => Promise<string | null>
  cancelCampaignBulk: () => Promise<void>
  resumePolling: (existingJobId: string) => Promise<void>
}

export function useCampaignBulkCreate(): UseCampaignBulkCreateReturn {
  const [isStarting, setIsStarting] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<CampaignBulkProgressResponse | null>(null)
  const mountedRef = useRef(true)
  const cancelledRef = useRef(false)
  const { addActiveJob, removeActiveJob } = useActiveJobsStore()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runPolling = useCallback(async (targetJobId: string) => {
    cancelledRef.current = false
    setIsCreating(true)
    setJobId(targetJobId)

    await pollJob<void>({
      label: `campaign-bulk-${targetJobId.slice(0, 8)}`,
      maxAttempts: 900,
      getCancelled: () => cancelledRef.current,
      getMounted: () => mountedRef.current,
      fetchProgress: () => api.campaignBulk.getProgress(targetJobId),
      handleProgress: (nextProgress) => {
        setProgress(nextProgress)
        const summary = nextProgress.summary
        const percent =
          summary.total > 0
            ? ((summary.success + summary.error) / summary.total) * 100
            : nextProgress.progress
        if (["completed", "failed", "cancelled"].includes(nextProgress.status)) {
          removeActiveJob(targetJobId)
          setIsCreating(false)
          return { done: true, result: undefined }
        }
        return { done: false, progressPercent: percent }
      },
      handleError: () => {},
      onTimeout: () => {
        removeActiveJob(targetJobId)
        setIsCreating(false)
      },
      onCancelled: () => {
        removeActiveJob(targetJobId)
        setIsCreating(false)
      },
      onUnmounted: () => {
        setIsCreating(false)
      },
      onMaxConsecutiveErrors: () => {
        removeActiveJob(targetJobId)
        setIsCreating(false)
      },
    })
  }, [removeActiveJob])

  const startCampaignBulk = useCallback(async (files: File[], config: CampaignBulkConfig) => {
    setIsStarting(true)
    try {
      const response = await api.campaignBulk.start(files, config)
      setJobId(response.job_id)
      addActiveJob(response.job_id)
      void runPolling(response.job_id)
      return response.job_id
    } finally {
      setIsStarting(false)
    }
  }, [addActiveJob, runPolling])

  const retryCampaignFailed = useCallback(async (currentJobId: string, itemIds: string[]) => {
    const response = await api.campaignBulk.retry(currentJobId, itemIds)
    setProgress(null)
    addActiveJob(response.job_id)
    void runPolling(response.job_id)
    return response.job_id
  }, [addActiveJob, runPolling])

  const cancelCampaignBulk = useCallback(async () => {
    if (!jobId) return
    cancelledRef.current = true
    await api.facebook.cancelJobsBatch([jobId], "Criacao de campanhas cancelada pelo usuario")
    setProgress((prev) => prev ? { ...prev, status: "cancelled" } : prev)
    removeActiveJob(jobId)
    setIsCreating(false)
  }, [jobId, removeActiveJob])

  const resumePolling = useCallback(async (existingJobId: string) => {
    addActiveJob(existingJobId)
    await runPolling(existingJobId)
  }, [addActiveJob, runPolling])

  return {
    isStarting,
    isCreating,
    jobId,
    progress,
    startCampaignBulk,
    retryCampaignFailed,
    cancelCampaignBulk,
    resumePolling,
  }
}
