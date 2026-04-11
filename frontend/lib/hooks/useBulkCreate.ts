"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api/endpoints"
import { pollJob } from "@/lib/utils/pollJob"
import { useActiveJobsStore } from "@/lib/store/activeJobs"
import type { BulkAdConfig, BulkAdProgressResponse } from "@/lib/api/schemas"

interface UseBulkCreateReturn {
  isCreating: boolean
  jobId: string | null
  progress: BulkAdProgressResponse | null
  startBulkCreate: (files: File[], config: BulkAdConfig) => Promise<string | null>
  retryFailed: (currentJobId: string, itemIds: string[]) => Promise<string | null>
  cancelBulkCreate: () => Promise<void>
  resumePolling: (existingJobId: string) => Promise<void>
}

export function useBulkCreate(): UseBulkCreateReturn {
  const [isCreating, setIsCreating] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<BulkAdProgressResponse | null>(null)
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
      label: `bulk-ads-${targetJobId.slice(0, 8)}`,
      maxAttempts: 900,
      getCancelled: () => cancelledRef.current,
      getMounted: () => mountedRef.current,
      fetchProgress: () => api.bulkAds.getProgress(targetJobId),
      handleProgress: (nextProgress) => {
        setProgress(nextProgress)
        const summary = nextProgress.summary
        const percent = summary.total > 0 ? ((summary.success + summary.error) / summary.total) * 100 : nextProgress.progress
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

  const startBulkCreate = useCallback(async (files: File[], config: BulkAdConfig) => {
    const response = await api.bulkAds.start(files, config)
    setJobId(response.job_id)
    addActiveJob(response.job_id)
    void runPolling(response.job_id)
    return response.job_id
  }, [addActiveJob, runPolling])

  const retryFailed = useCallback(async (currentJobId: string, itemIds: string[]) => {
    const response = await api.bulkAds.retry(currentJobId, itemIds)
    setProgress(null)
    addActiveJob(response.job_id)
    void runPolling(response.job_id)
    return response.job_id
  }, [addActiveJob, runPolling])

  const cancelBulkCreate = useCallback(async () => {
    if (!jobId) return
    cancelledRef.current = true
    await api.facebook.cancelJobsBatch([jobId], "Criacao em massa cancelada pelo usuario")
    removeActiveJob(jobId)
    setIsCreating(false)
  }, [jobId, removeActiveJob])

  const resumePolling = useCallback(async (existingJobId: string) => {
    addActiveJob(existingJobId)
    await runPolling(existingJobId)
  }, [addActiveJob, runPolling])

  return {
    isCreating,
    jobId,
    progress,
    startBulkCreate,
    retryFailed,
    cancelBulkCreate,
    resumePolling,
  }
}
