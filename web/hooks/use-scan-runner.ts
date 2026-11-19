"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/contexts/auth-context";
import { apiFetch } from "@/lib/api";
import type { JobRecord, ScanResult } from "@/lib/types";

export type ScanPhase = "idle" | "scanning" | "pass" | "violations" | "error";

export function useScanRunner(onComplete?: () => void) {
  const { accessToken } = useAuth();
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number | null>(null);

  const stopTimers = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const mapJob = useCallback(
    (job: JobRecord) => {
      if (job.state === "failed") {
        setPhase("error");
        setJobError(job.error || "Job failed");
        setResult(job.result ?? null);
        stopTimers();
        onComplete?.();
        return;
      }
      if (job.state === "completed" && job.result) {
        const s = job.result.status;
        if (s === "pass") setPhase("pass");
        else if (s === "violations") setPhase("violations");
        else setPhase("error");
        setResult(job.result);
        setJobError(job.result.error ?? null);
        stopTimers();
        onComplete?.();
        return;
      }
      setPhase("scanning");
    },
    [onComplete, stopTimers],
  );

  const pollJob = useCallback(
    async (id: string) => {
      try {
        const res = await apiFetch(`/api/jobs/${id}`, {}, accessToken);
        if (!res.ok) throw new Error(`Poll failed (${res.status})`);
        const job = (await res.json()) as JobRecord;
        mapJob(job);
      } catch (err) {
        setJobError(err instanceof Error ? err.message : "Poll failed");
        setPhase("error");
        stopTimers();
      }
    },
    [accessToken, mapJob, stopTimers],
  );

  useEffect(() => {
    return () => stopTimers();
  }, [stopTimers]);

  useEffect(() => {
    if (!jobId || phase !== "scanning") return;
    pollRef.current = setInterval(() => {
      void pollJob(jobId);
    }, 3000);
    tickRef.current = setInterval(() => {
      if (startedAt.current != null) {
        setElapsedSec(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 250);
    const initial = window.setTimeout(() => {
      void pollJob(jobId);
    }, 0);
    return () => {
      window.clearTimeout(initial);
      stopTimers();
    };
  }, [jobId, phase, pollJob, stopTimers]);

  const runScan = useCallback(
    async (body: Record<string, string>) => {
      setJobError(null);
      setResult(null);
      setJobId(null);
      setElapsedSec(0);
      stopTimers();
      setPhase("scanning");
      startedAt.current = Date.now();
      try {
        const res = await apiFetch(
          "/api/jobs/scan",
          { method: "POST", body: JSON.stringify(body) },
          accessToken,
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Scan failed (${res.status})`);
        }
        const data = (await res.json()) as { job_id: string };
        setJobId(data.job_id);
      } catch (err) {
        setPhase("error");
        setJobError(err instanceof Error ? err.message : "Could not start scan");
        stopTimers();
      }
    },
    [accessToken, stopTimers],
  );

  const reset = useCallback(() => {
    stopTimers();
    setPhase("idle");
    setJobId(null);
    setResult(null);
    setJobError(null);
    setElapsedSec(0);
  }, [stopTimers]);

  return {
    phase,
    jobId,
    result,
    jobError,
    elapsedSec,
    runScan,
    reset,
  };
}