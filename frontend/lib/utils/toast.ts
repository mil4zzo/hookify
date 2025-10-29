import { toast } from 'sonner'
import { AppError } from './errors'

export function showError(error: AppError) {
  toast.error(error.message)
}

export function showSuccess(message: string) {
  toast.success(message)
}

export function showInfo(message: string) {
  toast(message)
}


