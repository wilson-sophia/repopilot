/** biome-ignore-all lint/performance/noJsxPropsBind: Native DOM handlers do not invalidate memoized report boundaries; mapped actions need item context. */
"use client";

import "./index.css";

import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderOpen,
  Github,
  History,
  Layers3,
  LoaderCircle,
  Menu,
  Moon,
  PanelRight,
  Plus,
  Search,
  ShieldCheck,
  Square,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchSource } from "@/lib/research/types";
import { useResearchWorkspace } from "./use-research-workspace";
import {
  DocumentsPanel,
  formatDate,
  NewProjectDialog,
  RunView,
  SourceDialog,
  safeExternalUrl,
  sourceOrigin,
} from "./views";

const suggestions = [
  "结合项目文档，梳理主要能力、使用方式和接入注意事项。",
  "分析这个仓库的维护情况与相关 Issue，给出选型建议并附来源。",
  "根据我的项目需求，评估这个开源方案的适用性与待验证风险。",
];

/** 研发调研工作台。 Research workspace backed by persisted projects and streamed runs. */
export function ResearchWorkspace() {
  const workspace = useResearchWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [defaultRepository, setDefaultRepository] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedSource, setSelectedSource] = useState<ResearchSource | null>(
    null
  );
  const [toast, setToast] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    config,
    project,
    projects,
    documents,
    runs,
    loading,
    projectLoading,
    streaming,
    uploading,
    error,
    uploadMessage,
  } = workspace;
  const latestRun = runs.at(-1);
  const sources = latestRun?.sources ?? [];
  const repositoryUrl = project?.repository
    ? safeExternalUrl(
        project.repository.startsWith("http")
          ? project.repository
          : `https://github.com/${project.repository}`
      )
    : undefined;
  const hasRunning = streaming || runs.some((run) => run.status === "running");

  useEffect(
    () => () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
      }
    },
    []
  );
  useEffect(() => {
    if (project?.id) {
      setPrompt("");
      setSelectedSource(null);
    }
  }, [project?.id]);
  useEffect(() => {
    if (latestRun?.id) {
      document
        .getElementById(`run-${latestRun.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [latestRun?.id]);

  const openNewProject = useCallback((repository = "") => {
    setDefaultRepository(repository);
    setNewProjectOpen(true);
    setSidebarOpen(false);
  }, []);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }, []);
  const handleCopy = useCallback(
    (text: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("报告已复制"))
        .catch(() => showToast("复制失败，请使用导出报告。"));
    },
    [showToast]
  );
  const handleSourceSelect = useCallback(
    (source: ResearchSource) => setSelectedSource(source),
    []
  );
  const handleRetry = useCallback(
    (value: string) => {
      workspace.startRun(value).then((successful) => {
        if (!successful) {
          setPrompt((current) => current || value);
        }
      });
    },
    [workspace.startRun]
  );
  const submitPrompt = useCallback(() => {
    if (!prompt.trim() || hasRunning || uploading) {
      return;
    }
    const value = prompt;
    setPrompt("");
    workspace.startRun(value).then((successful) => {
      if (!successful) {
        setPrompt((current) => current || value);
      }
    });
    requestAnimationFrame(() => composer.current?.focus());
  }, [prompt, hasRunning, uploading, workspace.startRun]);

  return (
    <div className="research-workspace" data-testid="research-workspace">
      <div className="research-app-layout">
        <aside
          aria-label="项目导航"
          className="research-sidebar"
          data-open={sidebarOpen}
        >
          <a
            aria-label="RepoPilot 首页"
            className="research-brand"
            href="/research"
          >
            <span className="research-brand-symbol">
              <Layers3 size={20} strokeWidth={1.7} />
            </span>
            <span>
              <strong>RepoPilot</strong>
              <small>Research, with evidence</small>
            </span>
          </a>
          <button
            className="research-button research-new-project"
            disabled={hasRunning || !config}
            onClick={() => openNewProject()}
            type="button"
          >
            <Plus />
            新建项目
          </button>
          <nav
            aria-label="我的调研项目"
            className="research-project-navigation"
          >
            <div className="research-sidebar-heading">
              <span>我的项目</span>
              <span>{projects.length}</span>
            </div>
            {projects.map((entry) => (
              <button
                aria-current={project?.id === entry.id ? "page" : undefined}
                className="research-project-entry"
                data-project-id={entry.id}
                data-testid="project-card"
                disabled={hasRunning || projectLoading}
                key={entry.id}
                onClick={() => {
                  setSidebarOpen(false);
                  workspace.loadProject(entry.id);
                }}
                type="button"
              >
                <FolderOpen size={15} />
                <span>{entry.name}</span>
              </button>
            ))}
            {!projects.length && (
              <p className="research-sidebar-empty">
                {loading ? "正在加载项目…" : "创建项目，开始积累你的调研。"}
              </p>
            )}
          </nav>
          <div className="research-sidebar-bottom">
            <div className="research-sidebar-note">
              <p>
                让每一次技术判断
                <br />
                都有可追溯的依据。
              </p>
              <p className="mt-3">
                Built on{" "}
                <a
                  href="https://github.com/vercel/chatbot"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Vercel Chatbot
                </a>
              </p>
            </div>
            <div className="research-user">
              <span className="research-avatar">
                {config?.user.email.startsWith("guest-")
                  ? "访"
                  : (config?.user.email.slice(0, 1).toUpperCase() ?? "R")}
              </span>
              <span>
                {config?.user.email.startsWith("guest-")
                  ? "访客工作空间"
                  : (config?.user.email ?? "个人工作空间")}
              </span>
              {config?.user.email.startsWith("guest-") && (
                <a href="/login">登录</a>
              )}
            </div>
          </div>
          {Boolean(sidebarOpen) && (
            <button
              aria-label="关闭项目导航"
              className="research-button research-mobile-menu"
              onClick={() => setSidebarOpen(false)}
              type="button"
            >
              <X />
              关闭
            </button>
          )}
        </aside>

        <main className="research-main-shell">
          <header className="research-topbar">
            <button
              aria-label="打开项目导航"
              className="research-button research-mobile-menu"
              data-appearance="ghost"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Menu />
            </button>
            <div className="research-breadcrumb">
              <span>工作空间</span>
              <ChevronRight size={13} />
              <strong>{project?.name ?? "调研工作台"}</strong>
            </div>
            <div className="research-topbar-actions">
              {config !== null && (
                <span className="research-mode-pill" data-mode={config.mode}>
                  <i />
                  {config.mode === "demo" ? "演示模式" : "真实模型模式"}
                </span>
              )}
              {Boolean(project) && (
                <button
                  aria-label="查看项目资料"
                  className="research-button"
                  data-appearance="ghost"
                  onClick={() =>
                    document
                      .getElementById("research-documents-title")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                  type="button"
                >
                  <PanelRight />
                  <span>项目资料</span>
                </button>
              )}
              <button
                aria-label="切换主题"
                className="research-button"
                data-appearance="ghost"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
                type="button"
              >
                {resolvedTheme === "dark" ? <Sun /> : <Moon />}
              </button>
            </div>
          </header>

          {config?.mode === "demo" && (
            <div className="research-mode-notice" role="note">
              <CircleAlert size={13} />
              <span>
                当前为演示模式：使用确定性调研流程，不调用大模型；配置模型后可使用真实
                Agent 推理。
              </span>
            </div>
          )}
          {Boolean(error) && (
            <div className="research-error-notice" role="alert">
              <CircleAlert size={15} />
              <span>{error}</span>
              {!config && (
                <button onClick={() => workspace.initialize()} type="button">
                  重试
                </button>
              )}
              <button
                aria-label="关闭提示"
                onClick={() => workspace.setError(null)}
                type="button"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="research-loading" role="status">
              <LoaderCircle className="research-spin" size={20} />
              正在打开工作空间…
            </div>
          ) : project ? (
            projectLoading ? (
              <div className="research-loading" role="status">
                <LoaderCircle className="research-spin" size={20} />
                正在读取项目资料…
              </div>
            ) : (
              <div className="research-content-grid">
                <section
                  aria-label="项目调研"
                  className="research-conversation"
                >
                  <div className="research-project-header">
                    <div className="research-eyebrow">
                      <FolderOpen size={13} />
                      Research project
                    </div>
                    <h1>{project.name}</h1>
                    {Boolean(project.description) && (
                      <p className="research-project-description">
                        {project.description}
                      </p>
                    )}
                    <div className="research-project-meta">
                      {Boolean(repositoryUrl) && (
                        <a
                          href={repositoryUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          <Github size={12} />
                          {project.repository.replace(
                            /^https?:\/\/github\.com\//,
                            ""
                          )}
                          <ArrowUpRight size={11} />
                        </a>
                      )}
                      <span>{documents.length} 份资料</span>
                      <span>{runs.length} 次调研</span>
                    </div>
                  </div>

                  <div className="research-thread">
                    {!runs.length && (
                      <div className="research-project-welcome">
                        <h2>这次，想弄清楚什么？</h2>
                        <p>
                          提出一个具体问题，或先在右侧导入需求文档。
                          <br />
                          调研过程中，你可以查看每次工具调用与结果来源。
                        </p>
                        <div className="research-question-suggestions">
                          {suggestions.map((suggestion) => (
                            <button
                              className="research-question-suggestion"
                              key={suggestion}
                              onClick={() => {
                                setPrompt(suggestion);
                                composer.current?.focus();
                              }}
                              type="button"
                            >
                              <Search size={15} />
                              <span>{suggestion}</span>
                              <ArrowUpRight size={13} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {runs.map((run) => (
                      <RunView
                        disabled={hasRunning || uploading}
                        key={run.id}
                        onCopy={handleCopy}
                        onRetry={handleRetry}
                        onSourceSelect={handleSourceSelect}
                        run={run}
                      />
                    ))}
                    <div aria-live="polite" className="sr-only" role="status">
                      {hasRunning
                        ? "调研进行中"
                        : latestRun?.status === "completed"
                          ? "调研报告已生成"
                          : ""}
                    </div>
                  </div>

                  <div className="research-composer-area">
                    <form
                      className="research-composer"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitPrompt();
                      }}
                    >
                      <label
                        className="sr-only"
                        htmlFor="research-question-input"
                      >
                        研究问题
                      </label>
                      <textarea
                        disabled={hasRunning}
                        id="research-question-input"
                        maxLength={4000}
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            submitPrompt();
                          }
                        }}
                        placeholder="描述你想调研的问题，例如：这个项目适合接入我们的 React 应用吗？"
                        ref={composer}
                        value={prompt}
                      />
                      <div className="research-composer-controls">
                        <span className="research-composer-context">
                          <FileText size={12} />
                          {
                            documents.filter(
                              (entry) => entry.status === "ready"
                            ).length
                          }{" "}
                          份文档可检索
                          {project.repository ? " · 已关联 GitHub" : ""}
                        </span>
                        {hasRunning ? (
                          <button
                            className="research-button"
                            data-appearance="danger"
                            onClick={() => workspace.cancelRun()}
                            type="button"
                          >
                            <Square size={12} />
                            停止
                          </button>
                        ) : (
                          <button
                            className="research-button"
                            data-appearance="primary"
                            disabled={!prompt.trim() || uploading}
                            type="submit"
                          >
                            开始调研
                            <ArrowUp />
                          </button>
                        )}
                      </div>
                    </form>
                    <p className="research-composer-help">
                      Enter 发送，Shift + Enter 换行 ·
                      请结合引用来源核验调研结论
                    </p>
                  </div>
                </section>

                <aside
                  aria-label="资料与引用"
                  className="research-context-panel"
                >
                  <DocumentsPanel
                    dataSource={documents}
                    disabled={hasRunning}
                    message={uploadMessage}
                    onDelete={workspace.deleteDocument}
                    onUpload={workspace.uploadDocument}
                    uploading={uploading}
                  />
                  <section
                    aria-labelledby="research-sources-title"
                    className="research-panel-section"
                  >
                    <h2 id="research-sources-title">
                      <CheckCheck size={14} />
                      本次引用<span>{sources.length} 个来源</span>
                    </h2>
                    {sources.length ? (
                      <div className="research-source-list">
                        {sources.map((source, index) => (
                          <button
                            className="research-source-entry"
                            key={source.id}
                            onClick={() => handleSourceSelect(source)}
                            type="button"
                          >
                            <span className="research-source-number">
                              {index + 1}
                            </span>
                            <span className="research-source-copy">
                              <strong>{source.title}</strong>
                              <small>{sourceOrigin(source)}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="research-panel-empty">
                        调研引用的文档和仓库资料会显示在这里，点击即可核验原文。
                      </p>
                    )}
                  </section>
                  <section
                    aria-labelledby="research-history-title"
                    className="research-panel-section"
                  >
                    <h2 id="research-history-title">
                      <History size={14} />
                      调研历史<span>{runs.length} 条记录</span>
                    </h2>
                    {runs.length ? (
                      [...runs].reverse().map((run) => (
                        <button
                          className="research-history-entry"
                          key={run.id}
                          onClick={() =>
                            document
                              .getElementById(`run-${run.id}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              })
                          }
                          type="button"
                        >
                          <span>{run.prompt}</span>
                          <small>
                            {formatDate(run.createdAt)} ·{" "}
                            {run.status === "completed"
                              ? "已完成"
                              : run.status === "failed"
                                ? "失败"
                                : run.status === "cancelled"
                                  ? "已停止"
                                  : "进行中"}
                          </small>
                        </button>
                      ))
                    ) : (
                      <p className="research-panel-empty">
                        每次调研的过程与报告会自动保存。
                      </p>
                    )}
                  </section>
                </aside>
              </div>
            )
          ) : (
            <section className="research-empty-workspace">
              <div className="research-eyebrow">
                <Search size={15} />
                Your next technical decision
              </div>
              <h1>
                把技术判断，
                <br />
                建立在证据上。
              </h1>
              <p className="research-empty-description">
                连接开源仓库与项目文档。让 Agent 帮你检索资料、分析
                Issue、核验来源，把零散信息整理为一份清晰的技术调研。
              </p>
              <div className="research-start-actions">
                <button
                  className="research-button"
                  data-appearance="primary"
                  disabled={!config}
                  onClick={() => openNewProject()}
                  type="button"
                >
                  <Plus />
                  创建第一个项目
                  <ArrowRight />
                </button>
                <button
                  className="research-button"
                  disabled={!config}
                  onClick={() => openNewProject("vercel/chatbot")}
                  type="button"
                >
                  <Github />从 Vercel Chatbot 开始
                </button>
              </div>
              <div className="research-capabilities">
                <div className="research-capability">
                  <Github />
                  <h2>理解真实项目</h2>
                  <p>
                    查询公开仓库和相关 Issue，了解功能、维护状态与使用边界。
                  </p>
                </div>
                <div className="research-capability">
                  <BookOpen />
                  <h2>结合你的资料</h2>
                  <p>导入需求与技术文档，在你的项目上下文中寻找答案。</p>
                </div>
                <div className="research-capability">
                  <ShieldCheck />
                  <h2>每个结论可核验</h2>
                  <p>查看工具执行过程和引用原文，保留可回溯的调研记录。</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
      <NewProjectDialog
        defaultRepository={defaultRepository}
        onCreate={workspace.createProject}
        onOpenChange={setNewProjectOpen}
        open={newProjectOpen}
      />
      <SourceDialog
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSource(null);
          }
        }}
        source={selectedSource}
      />
      {Boolean(toast) && (
        <div className="research-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
