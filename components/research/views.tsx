/** biome-ignore-all lint/performance/noJsxPropsBind: Native DOM handlers do not invalidate memoized report boundaries; mapped actions need item context. */
"use client";

import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  Copy,
  FileText,
  LoaderCircle,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ResearchDocument,
  ResearchProject,
  ResearchRun,
  ResearchSource,
  ToolExecution,
} from "@/lib/research/types";
import { getErrorMessage, researchRequest } from "./api";

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function safeExternalUrl(value?: string) {
  if (!value) {
    return;
  }
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    // An invalid URL is deliberately rendered as non-interactive source text.
  }
}

export function sourceOrigin(source: ResearchSource) {
  if (source.kind === "document") {
    return "项目文档";
  }
  try {
    return source.url ? new URL(source.url).hostname : "GitHub";
  } catch {
    return "GitHub";
  }
}

const statusLabels: Record<ResearchRun["status"], string> = {
  cancelled: "已停止",
  completed: "已完成",
  failed: "执行失败",
  running: "正在调研",
};

export interface ToolTimelineProps {
  /** 执行状态列表。 Server-confirmed tool execution states. */
  dataSource: ToolExecution[];
}

export const ToolTimeline = memo(function ToolTimelineContent({
  dataSource,
}: ToolTimelineProps) {
  if (!dataSource.length) {
    return null;
  }
  return (
    <ol aria-label="工具执行过程" className="research-tool-timeline">
      {dataSource.map((tool) => (
        <li
          className="research-tool-step"
          data-status={tool.status}
          data-testid="tool-card"
          key={tool.id}
        >
          <div className="research-tool-marker">
            {tool.status === "completed" ? (
              <CheckCircle2 size={13} />
            ) : tool.status === "failed" ? (
              <CircleAlert size={13} />
            ) : (
              <LoaderCircle className="research-spin" size={13} />
            )}
          </div>
          <div className="research-tool-label">
            <span>{tool.description || tool.name}</span>
            <span className="research-status-label">
              {tool.status === "completed"
                ? "完成"
                : tool.status === "failed"
                  ? "失败"
                  : "执行中"}
            </span>
            {tool.durationMs !== undefined && (
              <time>
                {tool.durationMs < 1000
                  ? `${tool.durationMs} ms`
                  : `${(tool.durationMs / 1000).toFixed(1)} s`}
              </time>
            )}
          </div>
          {Boolean(tool.error) && (
            <p className="research-tool-summary">{tool.error}</p>
          )}
          <details className="research-tool-detail">
            <summary>查看调用详情</summary>
            <pre>
              {JSON.stringify(
                {
                  input: tool.input,
                  ...(tool.output === undefined ? {} : { output: tool.output }),
                },
                null,
                2
              )?.slice(0, 8000)}
            </pre>
          </details>
        </li>
      ))}
    </ol>
  );
});

export interface RunViewProps {
  disabled: boolean;
  onCopy: (text: string) => void;
  onRetry: (prompt: string) => void;
  onSourceSelect: (source: ResearchSource) => void;
  run: ResearchRun;
}

export const RunView = memo(function RunViewContent({
  run,
  disabled,
  onRetry,
  onSourceSelect,
  onCopy,
}: RunViewProps) {
  return (
    <article
      className="research-run"
      data-status={run.status}
      data-testid="research-run"
      id={`run-${run.id}`}
    >
      <div className="research-question">{run.prompt}</div>
      <div className="research-run-heading">
        <Search size={16} />
        <strong>RepoPilot</strong>
        <span className="research-status-label" data-status={run.status}>
          {statusLabels[run.status]}
        </span>
        <time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time>
      </div>
      <ToolTimeline dataSource={run.tools} />
      {run.report ? (
        <section
          aria-label="调研报告"
          className="research-report"
          data-testid="run-report"
        >
          <Streamdown>{run.report}</Streamdown>
        </section>
      ) : (
        <div className="research-run-empty">
          {run.status === "running" ? (
            <>
              <LoaderCircle className="research-spin" size={14} />
              正在整理资料与证据…
            </>
          ) : (
            <>
              <Circle size={14} />
              {run.status === "cancelled"
                ? "本次调研已停止，执行记录已保存。"
                : "本次未生成报告，可调整问题后重试。"}
            </>
          )}
        </div>
      )}
      {Boolean(run.error) && (
        <p className="research-run-error" role="alert">
          {run.error}
        </p>
      )}
      {run.sources.length > 0 && (
        <nav aria-label="本次引用来源" className="research-report-source-list">
          {run.sources.map((source, index) => (
            <button
              className="research-report-source-button"
              data-testid="source-button"
              key={source.id}
              onClick={() => onSourceSelect(source)}
              type="button"
            >
              <FileText size={11} />
              <span>
                {index + 1}. {source.title}
              </span>
            </button>
          ))}
        </nav>
      )}
      {run.status !== "running" && (
        <div className="research-run-actions">
          {Boolean(run.report) && (
            <>
              <button
                className="research-button"
                data-appearance="ghost"
                onClick={() => onCopy(run.report)}
                type="button"
              >
                <Copy />
                复制
              </button>
              <a
                className="research-button"
                data-appearance="ghost"
                download
                href={`/api/research/runs/${run.id}/export`}
              >
                <ArrowDownToLine />
                导出报告
              </a>
            </>
          )}
          <button
            className="research-button"
            data-appearance="ghost"
            disabled={disabled}
            onClick={() => onRetry(run.prompt)}
            type="button"
          >
            <RotateCcw />
            重新调研
          </button>
          <span className="research-run-usage">
            {run.mode === "demo"
              ? "演示流程 · 未调用模型"
              : `${run.model} · ${(run.inputTokens + run.outputTokens).toLocaleString()} tokens`}
            {run.durationMs > 0
              ? ` · ${(run.durationMs / 1000).toFixed(1)} s`
              : ""}
          </span>
        </div>
      )}
    </article>
  );
});

export interface DocumentsPanelProps {
  dataSource: ResearchDocument[];
  disabled: boolean;
  message: string;
  onDelete: (id: string) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
}

export const DocumentsPanel = memo(function DocumentsPanelContent({
  dataSource,
  disabled,
  uploading,
  message,
  onUpload,
  onDelete,
}: DocumentsPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <section
      aria-labelledby="research-documents-title"
      className="research-panel-section"
    >
      <h2 id="research-documents-title">
        <FileText size={14} />
        项目资料<span>{dataSource.length} 份文档</span>
      </h2>
      <div className="research-document-list">
        {dataSource.map((document) => (
          <div
            className="research-document-entry"
            data-testid="document-card"
            key={document.id}
          >
            <FileText size={14} />
            <div className="research-document-info">
              <strong title={document.name}>{document.name}</strong>
              <small>
                {document.status === "ready"
                  ? `${document.chunkCount} 个片段 · 已索引`
                  : `索引失败：${document.error ?? "请重新上传"}`}
              </small>
            </div>
            <button
              aria-label={`删除文档 ${document.name}`}
              className="research-document-remove"
              disabled={disabled || uploading}
              onClick={() => onDelete(document.id)}
              type="button"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <input
        accept=".md,.markdown,.txt,text/plain,text/markdown"
        aria-label="上传文档"
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onUpload(file);
          }
          event.target.value = "";
        }}
        ref={input}
        type="file"
      />
      <button
        className="research-upload"
        data-dragging={dragging}
        disabled={disabled || uploading}
        onClick={() => input.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !uploading) {
            setDragging(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file && !disabled && !uploading) {
            onUpload(file);
          }
        }}
        type="button"
      >
        {uploading ? (
          <LoaderCircle className="research-spin" size={17} />
        ) : (
          <Upload size={17} />
        )}
        <span>{uploading ? "正在解析并建立索引…" : "点击或拖入项目文档"}</span>
        <small>Markdown / TXT</small>
      </button>
      {Boolean(message) && (
        <p className="research-upload-status" role="status">
          {message}
        </p>
      )}
    </section>
  );
});

export interface SourceDialogProps {
  onOpenChange: (open: boolean) => void;
  source: ResearchSource | null;
}

export function SourceDialog({ source, onOpenChange }: SourceDialogProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let ignore = false;
    setContent("");
    setError("");
    if (!source?.documentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    researchRequest<{ document: ResearchDocument; content: string }>(
      `/documents/${source.documentId}`
    )
      .then((result) => {
        if (!ignore) {
          setContent(result.content);
        }
      })
      .catch((caught) => {
        if (!ignore) {
          setError(getErrorMessage(caught));
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [source]);
  const externalUrl = safeExternalUrl(source?.url);
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(source)}>
      <DialogContent
        className="research-dialog research-source-dialog"
        data-testid="source-drawer"
      >
        <DialogHeader>
          <DialogTitle>{source?.title ?? "引用来源"}</DialogTitle>
          <DialogDescription>
            {source
              ? `${sourceOrigin(source)} · 检索于 ${formatDate(source.retrievedAt)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div>
          <h3 className="mb-2 text-xs font-medium">引用片段</h3>
          <pre>
            {source?.excerpt ||
              "此来源未返回可预览的内容，请打开原始链接核验。"}
          </pre>
        </div>
        {Boolean(loading) && (
          <p className="research-panel-empty">正在读取文档原文…</p>
        )}
        {Boolean(error) && (
          <p className="research-form-error" role="alert">
            {error}
          </p>
        )}
        {Boolean(content) && (
          <details>
            <summary className="mb-2 cursor-pointer text-xs">
              查看文档全文
            </summary>
            <pre data-testid="source-document-content">{content}</pre>
          </details>
        )}
        {Boolean(externalUrl) && (
          <a href={externalUrl} rel="noopener noreferrer" target="_blank">
            打开原始来源
            <ArrowUpRight size={14} />
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface NewProjectDialogProps {
  defaultRepository?: string;
  onCreate: (
    values: Pick<ResearchProject, "name" | "description" | "repository">
  ) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function NewProjectDialog({
  open,
  defaultRepository = "",
  onOpenChange,
  onCreate,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repository, setRepository] = useState(defaultRepository);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setName(defaultRepository ? "Vercel Chatbot 技术调研" : "");
      setRepository(defaultRepository);
      setDescription("");
      setError("");
    }
  }, [open, defaultRepository]);
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!submitting) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <DialogContent className="research-dialog">
        <DialogHeader>
          <DialogTitle>新建调研项目</DialogTitle>
          <DialogDescription>
            关联一个开源仓库，导入你的需求文档，开始有据可查的技术调研。
          </DialogDescription>
        </DialogHeader>
        <form
          className="research-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSubmitting(true);
            setError("");
            try {
              await onCreate({
                description: description.trim(),
                name: name.trim(),
                repository: repository.trim(),
              });
              onOpenChange(false);
            } catch (caught) {
              setError(getErrorMessage(caught));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="research-form-field">
            <label htmlFor="research-project-name">项目名称</label>
            <input
              autoComplete="off"
              autoFocus
              id="research-project-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：编辑器技术选型"
              required
              value={name}
            />
          </div>
          <div className="research-form-field">
            <label htmlFor="research-project-repository">
              GitHub 仓库 <span>（可选）</span>
            </label>
            <input
              aria-label="GitHub 仓库"
              autoComplete="off"
              id="research-project-repository"
              maxLength={250}
              onChange={(event) => setRepository(event.target.value)}
              placeholder="https://github.com/owner/repository"
              value={repository}
            />
            <small>支持公开仓库地址或 owner/repository。</small>
          </div>
          <div className="research-form-field">
            <label htmlFor="research-project-description">
              项目描述 <span>（可选）</span>
            </label>
            <textarea
              aria-label="项目描述"
              id="research-project-description"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="描述业务场景、技术约束或你想了解的问题…"
              value={description}
            />
          </div>
          {Boolean(error) && (
            <p className="research-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="research-form-actions">
            <button
              className="research-button"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              取消
            </button>
            <button
              className="research-button"
              data-appearance="primary"
              disabled={submitting || !name.trim()}
              type="submit"
            >
              {Boolean(submitting) && (
                <LoaderCircle className="research-spin" />
              )}
              {submitting ? "正在创建…" : "创建项目"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
