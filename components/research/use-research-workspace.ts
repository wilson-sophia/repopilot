"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ResearchConfig,
  ResearchDocument,
  ResearchEvent,
  ResearchProject,
  ResearchRun,
} from "@/lib/research/types";
import { getErrorMessage, readResearchStream, researchRequest } from "./api";

interface ProjectDetail {
  documents: ResearchDocument[];
  project: ResearchProject;
  runs: ResearchRun[];
}

export function useResearchWorkspace() {
  const [config, setConfig] = useState<ResearchConfig | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [project, setProject] = useState<ResearchProject | null>(null);
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState("");
  const requestSequence = useRef(0);
  const activeRunId = useRef<string | null>(null);
  const streamController = useRef<AbortController | null>(null);
  const pendingText = useRef("");
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const upsertRun = useCallback((run: ResearchRun) => {
    setRuns((previous) => {
      const index = previous.findIndex((entry) => entry.id === run.id);
      if (index < 0) {
        return [...previous, run];
      }
      return previous.map((entry) => (entry.id === run.id ? run : entry));
    });
  }, []);

  const loadProject = useCallback(async (id: string) => {
    requestSequence.current += 1;
    const sequence = requestSequence.current;
    setProjectLoading(true);
    setError(null);
    try {
      const detail = await researchRequest<ProjectDetail>(`/projects/${id}`);
      if (sequence !== requestSequence.current || !mounted.current) {
        return;
      }
      setProject(detail.project);
      setDocuments(detail.documents);
      setRuns(
        [...detail.runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      );
      window.localStorage.setItem("repopilot:selected-project", id);
      setUploadMessage("");
    } catch (caught) {
      if (sequence === requestSequence.current && mounted.current) {
        setError(getErrorMessage(caught));
      }
    } finally {
      if (sequence === requestSequence.current && mounted.current) {
        setProjectLoading(false);
      }
    }
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextConfig, result] = await Promise.all([
        researchRequest<ResearchConfig>("/config"),
        researchRequest<{ projects: ResearchProject[] }>("/projects"),
      ]);
      if (!mounted.current) {
        return;
      }
      setConfig(nextConfig);
      setProjects(result.projects);
      const stored = window.localStorage.getItem("repopilot:selected-project");
      const selected =
        result.projects.find((entry) => entry.id === stored) ??
        result.projects[0];
      if (selected) {
        await loadProject(selected.id);
      }
    } catch (caught) {
      if (mounted.current) {
        setError(getErrorMessage(caught));
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, [loadProject]);

  useEffect(() => {
    mounted.current = true;
    initialize();
    return () => {
      mounted.current = false;
      streamController.current?.abort();
      if (textTimer.current) {
        clearTimeout(textTimer.current);
      }
    };
  }, [initialize]);

  // A saved in-progress run may outlive a tab refresh. Poll persisted state; never invent a completion.
  useEffect(() => {
    const running = runs.filter((run) => run.status === "running");
    if (streaming || !running.length) {
      return;
    }
    const timer = setInterval(() => {
      for (const run of running) {
        researchRequest<{ run: ResearchRun }>(`/runs/${run.id}`)
          .then((result) => mounted.current && upsertRun(result.run))
          .catch(() => {
            /* Retry the persisted state on the next polling tick. */
          });
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [runs, streaming, upsertRun]);

  const createProject = useCallback(
    async (values: {
      name: string;
      description: string;
      repository: string;
    }) => {
      const result = await researchRequest<{ project: ResearchProject }>(
        "/projects",
        {
          body: JSON.stringify(values),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      setProjects((previous) => [result.project, ...previous]);
      await loadProject(result.project.id);
      return result.project;
    },
    [loadProject]
  );

  const flushText = useCallback(() => {
    if (textTimer.current) {
      clearTimeout(textTimer.current);
    }
    textTimer.current = null;
    const delta = pendingText.current;
    pendingText.current = "";
    if (!delta) {
      return;
    }
    const id = activeRunId.current;
    setRuns((previous) =>
      previous.map((run) =>
        run.id === id ? { ...run, report: run.report + delta } : run
      )
    );
  }, []);

  const startRun = useCallback(
    async (prompt: string) => {
      if (!project || streaming || streamController.current || !prompt.trim()) {
        return false;
      }
      setError(null);
      setStreaming(true);
      activeRunId.current = null;
      pendingText.current = "";
      const controller = new AbortController();
      streamController.current = controller;
      let terminal = false;
      let successful = false;
      const onEvent = (event: ResearchEvent) => {
        if (!mounted.current) {
          return;
        }
        if (event.type === "run") {
          activeRunId.current = event.run.id;
          upsertRun(event.run);
        } else if (event.type === "text") {
          // Batch text independently from tool/source updates to avoid reparsing Markdown per token.
          pendingText.current += event.delta;
          if (!textTimer.current) {
            textTimer.current = setTimeout(flushText, 40);
          }
        } else if (event.type === "tool") {
          setRuns((previous) =>
            previous.map((run) =>
              run.id === activeRunId.current
                ? {
                    ...run,
                    tools: run.tools.some((tool) => tool.id === event.tool.id)
                      ? run.tools.map((tool) =>
                          tool.id === event.tool.id ? event.tool : tool
                        )
                      : [...run.tools, event.tool],
                  }
                : run
            )
          );
        } else if (event.type === "source") {
          setRuns((previous) =>
            previous.map((run) =>
              run.id === activeRunId.current
                ? {
                    ...run,
                    sources: run.sources.some(
                      (source) => source.id === event.source.id
                    )
                      ? run.sources.map((source) =>
                          source.id === event.source.id ? event.source : source
                        )
                      : [...run.sources, event.source],
                  }
                : run
            )
          );
        } else if (event.type === "done") {
          flushText();
          terminal = true;
          successful = event.run.status === "completed";
          upsertRun(event.run);
        } else if (event.type === "error") {
          flushText();
          terminal = true;
          setError(event.message);
          if (event.run) {
            upsertRun(event.run);
          }
        }
      };
      try {
        const response = await fetch(
          `/api/research/projects/${project.id}/runs`,
          {
            body: JSON.stringify({ prompt: prompt.trim() }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: controller.signal,
          }
        );
        if (!response.ok || !response.body) {
          const payload: { error?: string } = await response
            .json()
            .catch(() => ({}));
          throw new Error(
            payload.error ?? `无法开始调研（${response.status}）`
          );
        }
        await readResearchStream(response.body, onEvent);
        flushText();
        if (!terminal && !controller.signal.aborted) {
          throw new Error(
            "实时连接已中断，已保存的执行记录仍可查看。请刷新状态后重试。"
          );
        }
        return successful;
      } catch (caught) {
        flushText();
        if (!controller.signal.aborted) {
          setError(getErrorMessage(caught));
        }
        if (activeRunId.current) {
          try {
            const result = await researchRequest<{ run: ResearchRun }>(
              `/runs/${activeRunId.current}`
            );
            if (mounted.current) {
              upsertRun(result.run);
            }
          } catch {
            /* Keep the last server-confirmed state if the network is unavailable. */
          }
        }
        return false;
      } finally {
        if (mounted.current) {
          setStreaming(false);
        }
        streamController.current = null;
      }
    },
    [project, streaming, flushText, upsertRun]
  );

  const cancelRun = useCallback(async () => {
    const id =
      activeRunId.current ?? runs.find((run) => run.status === "running")?.id;
    try {
      if (id) {
        const result = await researchRequest<{ run: ResearchRun }>(
          `/runs/${id}/cancel`,
          { method: "POST" }
        );
        flushText();
        upsertRun(result.run);
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      streamController.current?.abort();
      flushText();
      setStreaming(false);
    }
  }, [flushText, runs, upsertRun]);

  const uploadDocument = useCallback(
    async (file: File) => {
      if (!project || uploading || streaming) {
        return;
      }
      setError(null);
      setUploadMessage("");
      if (!/\.(md|markdown|txt)$/i.test(file.name)) {
        setUploadMessage("请选择 Markdown（.md）或 TXT 文档。");
        return;
      }
      if (config && file.size > config.limits.maxFileBytes) {
        setUploadMessage(
          `文档超过 ${Math.round(config.limits.maxFileBytes / 1024)} KB 的大小限制。`
        );
        return;
      }
      setUploading(true);
      try {
        const body = new FormData();
        body.set("file", file);
        const result = await researchRequest<{ document: ResearchDocument }>(
          `/projects/${project.id}/documents`,
          { body, method: "POST" }
        );
        setDocuments((previous) => [result.document, ...previous]);
        setUploadMessage(
          result.document.status === "ready"
            ? `已导入 ${result.document.name}，生成 ${result.document.chunkCount} 个检索片段。`
            : (result.document.error ?? "文档索引失败，请删除后重新导入。")
        );
      } catch (caught) {
        setUploadMessage(getErrorMessage(caught));
      } finally {
        setUploading(false);
      }
    },
    [project, uploading, streaming, config]
  );

  const deleteDocument = useCallback(async (id: string) => {
    try {
      await researchRequest(`/documents/${id}`, { method: "DELETE" });
      setDocuments((previous) =>
        previous.filter((document) => document.id !== id)
      );
      setUploadMessage("文档已删除，后续调研不会再检索此文档。");
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  return {
    cancelRun,
    config,
    createProject,
    deleteDocument,
    documents,
    error,
    initialize,
    loading,
    loadProject,
    project,
    projectLoading,
    projects,
    runs,
    setError,
    startRun,
    streaming,
    uploadDocument,
    uploading,
    uploadMessage,
  };
}
