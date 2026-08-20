import { useQuery } from "@tanstack/vue-query";
import type { EmployerInquiryState } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

/** `/api/recruitment/inquiry-queue` — every §391.23 file with work left (E5). */

export interface InquiryQueueRow {
  driverId: string;
  name: string;
  status: string;
  hireDate: string | null;
  employers: EmployerInquiryState[];
  outstanding: EmployerInquiryState[];
  fileDeadline: string | null;
  daysToDeadline: number | null;
  complete: boolean;
}

export interface InquiryQueueSummary {
  drivers: number;
  outstanding: number;
  overdue: number;
  chaseable: number;
}

export function useInquiryQueueQuery() {
  return useQuery({
    queryKey: ["recruitment", "inquiry-queue"] as const,
    queryFn: async (): Promise<{ rows: InquiryQueueRow[]; summary: InquiryQueueSummary }> => {
      const res = await apiFetch<{ rows: InquiryQueueRow[]; summary: InquiryQueueSummary }>(
        "/api/recruitment/inquiry-queue",
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the inquiry queue.");
      return res.data;
    },
  });
}
