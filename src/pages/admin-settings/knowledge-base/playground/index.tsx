import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { handleAlert } from '@/lib/utils';
import { getChatAgentList, getAIReceptionistList } from '@/services/api';
import { MessageSquare, Phone, Search, Activity, Zap } from 'lucide-react';
import Loader from '@/components/custom/loader';
import CustomAvatar from '@/components/custom/custom-avatar';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAi360WidgetKey, getChatWidgetScriptSrc } from '../ai-agent/chat-agent-configure-modal';

const EMBED_SCRIPT_ID = 'ai-agent-test-embed-script';
const CHAT_WIDGET_MAX_WIDTH = 423;
const CHAT_WIDGET_MAX_HEIGHT = 600;
const CALL_WIDGET_MAX_WIDTH = 360;
const CALL_WIDGET_MAX_HEIGHT = 580;
const CHAT_WIDGET_VIEWPORT_GAP = 8;

const sanitizeWidgetKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');

const unloadEmbedScript = () => {
  document
    .querySelectorAll(`script#${EMBED_SCRIPT_ID}, script[data-playground-widget-script="true"]`)
    .forEach((script) => script.remove());

  ['agent-chat-widget', 'agent-talk-widget'].forEach((id) => {
    const iframe = document.getElementById(id);
    if (iframe) iframe.remove();
  });

  const widgetRoot = document.getElementById('ai-chat-widget-root');
  if (widgetRoot) widgetRoot.innerHTML = '';
  document
    .querySelectorAll(
      '[data-ai-widget], [id^="ai-widget"], [id^="mcm-widget"], [id^="ai360-widget-"]',
    )
    .forEach((el) => el.remove());
};

// function StatCard({ label, value }: { label: string; value: string | number }) {
//   return (
//     <div className="min-h-[76px] rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
//       <p className="text-sm text-slate-500">{label}</p>
//       <p className="mt-1 text-2xl font-bold leading-7 text-gray-950">{value}</p>
//     </div>
//   );
// }

function Playground() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialState = location.state as any;
  const [activeTab, setActiveTab] = useState<'chat' | 'voice'>(
    initialState?.activeTab === 'chat' ? 'chat' : 'voice',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<any>(initialState?.selectedAgent || null);
  const [activeEmbedId, setActiveEmbedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, height: 0 });

  const embedLoadingRef = useRef(false);
  const embedRequestIdRef = useRef(0);
  const widgetOpenTimerRef = useRef<number | null>(null);
  const activeWidgetIdRef = useRef('');

  const invalidateEmbedRequest = useCallback(() => {
    embedRequestIdRef.current += 1;
    embedLoadingRef.current = false;
    if (widgetOpenTimerRef.current !== null) {
      window.clearTimeout(widgetOpenTimerRef.current);
      widgetOpenTimerRef.current = null;
    }
    unloadEmbedScript();
    setActiveEmbedId(null);
  }, []);

  const widgetFrame = useMemo(() => {
    const viewportWidth =
      typeof window === 'undefined' ? coords.left + coords.width : window.innerWidth;
    const viewportHeight =
      typeof window === 'undefined' ? coords.top + coords.height : window.innerHeight;
    const maxWidgetWidth = activeTab === 'voice' ? CALL_WIDGET_MAX_WIDTH : CHAT_WIDGET_MAX_WIDTH;
    const maxWidgetHeight = activeTab === 'voice' ? CALL_WIDGET_MAX_HEIGHT : CHAT_WIDGET_MAX_HEIGHT;
    const panelGap = coords.width <= maxWidgetWidth + 24 ? 8 : 16;
    const panelWidth = Math.max(0, coords.width - panelGap * 2);
    const viewportWidthLimit = Math.max(0, viewportWidth - CHAT_WIDGET_VIEWPORT_GAP * 2);
    const width = Math.min(maxWidgetWidth, panelWidth, viewportWidthLimit);
    const viewportHeightLimit = Math.max(0, viewportHeight - coords.top - CHAT_WIDGET_VIEWPORT_GAP);
    const height = Math.min(maxWidgetHeight, Math.max(0, coords.height), viewportHeightLimit);
    const centeredLeft = coords.left + (coords.width - width) / 2;
    const maxLeft = viewportWidth - width - CHAT_WIDGET_VIEWPORT_GAP;
    const left = Math.max(CHAT_WIDGET_VIEWPORT_GAP, Math.min(centeredLeft, maxLeft));
    const centeredTop = coords.top + Math.max(0, (coords.height - height) / 2);
    const maxTop = viewportHeight - height - CHAT_WIDGET_VIEWPORT_GAP;
    const top = Math.max(CHAT_WIDGET_VIEWPORT_GAP, Math.min(centeredTop, maxTop));

    return { top, left, width, height };
  }, [activeTab, coords]);

  // Query chatbot agents
  const { data: chatAgents = [], isLoading: isChatLoading } = useQuery({
    queryKey: ['getChatAgentList', 'playground-list'],
    queryFn: () => getChatAgentList({ page: 1, limit: 1000, filters: [], search: '' }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });

  // Query receptionist agents
  const { data: receptionistAgents = [], isLoading: isReceptionistLoading } = useQuery({
    queryKey: ['getAIReceptionistList', 'playground-list'],
    queryFn: () => getAIReceptionistList({ page: 1, limit: 1000, filters: [], search: '' }),
    select: (data: any) => data?.data?.data?.result?.rows || [],
  });

  // Monitor bounding rect of middle container for absolute/fixed iframe positioning
  useEffect(() => {
    if (!selectedAgent || !containerRef.current) return;

    const updateCoords = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCoords({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updateCoords();

    const resizeObserver = new ResizeObserver(() => {
      updateCoords();
    });
    resizeObserver.observe(containerRef.current);

    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', updateCoords);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords);
    };
  }, [selectedAgent, activeTab]);

  // Cleanup embed script on unmount
  useEffect(() => {
    return () => {
      embedRequestIdRef.current += 1;
      if (widgetOpenTimerRef.current !== null) {
        window.clearTimeout(widgetOpenTimerRef.current);
      }
      unloadEmbedScript();
    };
  }, []);

  // Sync selected agent when tab changes
  useEffect(() => {
    setSelectedAgent(null);
    invalidateEmbedRequest();
  }, [activeTab, invalidateEmbedRequest]);

  useEffect(() => {
    if (!initialState?.selectedAgent) return;
    setSelectedAgent(initialState.selectedAgent);
    setActiveTab(initialState.activeTab === 'chat' ? 'chat' : 'voice');
  }, [initialState?.activeTab, initialState?.selectedAgent]);

  const handleLoadAgentWidget = useCallback(
    (rowData: any) => {
      const rowId = rowData?.agent_uuid || rowData?.id;
      const mode = activeTab === 'voice' ? 'call' : 'chat';
      const widgetKey = getAi360WidgetKey(rowData);
      const widgetScriptSrc = getChatWidgetScriptSrc();

      invalidateEmbedRequest();
      const requestId = embedRequestIdRef.current;

      if (!widgetKey) {
        handleAlert({ text: 'Widget key is missing for this agent.', type: 'error' });
        return;
      }

      if (!widgetScriptSrc) {
        handleAlert({ text: 'AI widget URL is missing.', type: 'error' });
        return;
      }

      embedLoadingRef.current = true;

      try {
        const script = document.createElement('script');
        script.id = EMBED_SCRIPT_ID;
        script.src = widgetScriptSrc;
        script.setAttribute('data-playground-widget-script', 'true');
        script.setAttribute('data-widget-mode', mode);
        script.setAttribute('data-widget-key', widgetKey);
        script.setAttribute('data-position', 'bottom-right');
        script.setAttribute('data-label', 'Need Help?');
        script.async = true;
        script.type = 'text/javascript';
        script.onload = () => {
          script.remove();
          if (requestId !== embedRequestIdRef.current) return;

          widgetOpenTimerRef.current = window.setTimeout(() => {
            widgetOpenTimerRef.current = null;
            if (requestId !== embedRequestIdRef.current) return;

            const widgetId = `ai360-widget-${mode}-${sanitizeWidgetKey(widgetKey)}`;
            document.getElementById(widgetId)?.querySelector('button')?.click();
            embedLoadingRef.current = false;
            setActiveEmbedId(rowId);
          }, 0);
        };
        script.onerror = () => {
          script.remove();
          if (requestId !== embedRequestIdRef.current) return;

          embedLoadingRef.current = false;
          unloadEmbedScript();
          setActiveEmbedId(null);
          handleAlert({
            text: `Failed to load ${mode === 'call' ? 'call' : 'chat'} widget. Please try again.`,
            type: 'error',
          });
        };

        document.body.appendChild(script);
      } catch (err) {
        if (requestId !== embedRequestIdRef.current) return;

        embedLoadingRef.current = false;
        console.error('Failed to load embed script:', err);
        handleAlert({
          text: `Failed to load ${mode === 'call' ? 'call' : 'chat'} widget. Please try again.`,
          type: 'error',
        });
        unloadEmbedScript();
      }
    },
    [activeTab, invalidateEmbedRequest],
  );

  const handleSelectAgent = (agent: any) => {
    invalidateEmbedRequest();
    setSelectedAgent(agent);
  };

  useEffect(() => {
    if (!selectedAgent) return;
    const rowId = selectedAgent?.agent_uuid || selectedAgent?.id;
    if (activeEmbedId === rowId || embedLoadingRef.current) return;
    const timer = window.setTimeout(() => {
      handleLoadAgentWidget(selectedAgent);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [activeEmbedId, handleLoadAgentWidget, selectedAgent]);

  const currentAgentsList = useMemo(() => {
    return activeTab === 'chat' ? chatAgents : receptionistAgents;
  }, [activeTab, chatAgents, receptionistAgents]);

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return currentAgentsList;
    return currentAgentsList.filter((agent: any) =>
      String(agent?.agentName || '')
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
    );
  }, [currentAgentsList, searchQuery]);

  const totalAgentsCount = chatAgents.length + receptionistAgents.length;
  const isPageLoading = isChatLoading || isReceptionistLoading;

  const isWidgetActive = useMemo(() => {
    if (!selectedAgent) return false;
    const rowId = selectedAgent?.agent_uuid || selectedAgent?.id;
    return activeEmbedId === rowId;
  }, [selectedAgent, activeEmbedId]);

  const activeWidgetMode = activeTab === 'voice' ? 'call' : 'chat';
  const activeWidgetKey = selectedAgent ? getAi360WidgetKey(selectedAgent) : '';
  const activeWidgetId = activeWidgetKey
    ? `ai360-widget-${activeWidgetMode}-${sanitizeWidgetKey(activeWidgetKey)}`
    : '';
  activeWidgetIdRef.current = activeWidgetId;

  useEffect(() => {
    const removeInactiveWidgetRoots = () => {
      document
        .querySelectorAll<HTMLElement>(
          'body > [data-ai-widget], body > [id^="ai-widget"], body > [id^="mcm-widget"], body > [id^="ai360-widget-"]',
        )
        .forEach((element) => {
          if (!activeWidgetIdRef.current || element.id !== activeWidgetIdRef.current) {
            element.remove();
          }
        });
    };

    removeInactiveWidgetRoots();
    const observer = new MutationObserver(removeInactiveWidgetRoots);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-auto bg-[#f3f4f6] text-[#07142f]">
      {/* Dynamic Style Override to position AI360 widget in Middle Panel */}
      {selectedAgent && activeWidgetId && (
        <style>{`
          body > [data-ai-widget],
          body > [id^="ai-widget"],
          body > [id^="mcm-widget"],
          body > [id^="ai360-widget-"] {
            display: none !important;
          }
          #${activeWidgetId} {
            display: block !important;
            position: fixed !important;
            top: ${widgetFrame.top}px !important;
            left: ${widgetFrame.left}px !important;
            right: auto !important;
            bottom: auto !important;
            width: ${widgetFrame.width}px !important;
            min-width: 0 !important;
            max-width: calc(100vw - ${CHAT_WIDGET_VIEWPORT_GAP * 2}px) !important;
            height: ${widgetFrame.height}px !important;
            max-height: calc(100vh - ${CHAT_WIDGET_VIEWPORT_GAP * 2}px) !important;
            box-sizing: border-box !important;
            z-index: 40 !important;
            margin: 0 !important;
            transform: none !important;
          }
          #${activeWidgetId} iframe {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            height: 100% !important;
            max-height: 100% !important;
            box-sizing: border-box !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: ${activeWidgetMode === 'call' ? 28 : 12}px !important;
            box-shadow: none !important;
          }
        `}</style>
      )}

      {/* Page Header (Matching other AI pages) */}
      <div className="flex min-h-[64px] items-center justify-between border-b border-gray-200 bg-white px-4 shrink-0">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-500">
          <button
            type="button"
            onClick={() => navigate('/admin-settings/knowledge/ai-agent')}
            className="transition-colors hover:text-primary"
          >
            AI Agents
          </button>
          <span>/</span>
          <span className="text-gray-950">Playground</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 pb-2">
        {/* Was a dark slate hero with an indigo-to-purple gradient tile, a
            pulsing sparkle and a radial glow — the only thing in admin that
            looks like that, and a fixed dark block that stayed dark in the
            light theme. It also gave three plain counts the visual weight of
            an advertisement. The counts are the same shape the receptionist
            and chat-agent lists use for theirs. */}
        <div className="mcm-pg-head">
          <div className="mcm-pg-t">
            <h1>Agent playground</h1>
            <p>
              Test any AI receptionist or chat agent against a real widget. Nothing here counts
              towards your analytics.
            </p>
          </div>
          <div className="mcm-pg-counts">
            <div>
              <p>Total agents</p>
              <b>{isPageLoading ? '—' : totalAgentsCount}</b>
            </div>
            <div>
              <p>Receptionists</p>
              <b>{isPageLoading ? '—' : receptionistAgents?.length}</b>
            </div>
            <div>
              <p>Chat agents</p>
              <b>{isPageLoading ? '—' : chatAgents?.length || 0}</b>
            </div>
          </div>
        </div>

        {/* Workspace Columns */}
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
          {/* Left Column: Pick Agent List */}
          <div className="mcm-pg-col">
            <div className="mcm-pg-colhead">
              {/* Mini Tabs (Primary UCAAS selected tab) */}
              <div className="mcm-pg-tabs" role="tablist" aria-label="Agent kind">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'voice'}
                  onClick={() => setActiveTab('voice')}
                  className={`mcm-pg-tab${activeTab === 'voice' ? ' is-on' : ''}`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  Receptionists
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'chat'}
                  onClick={() => setActiveTab('chat')}
                  className={`mcm-pg-tab${activeTab === 'chat' ? ' is-on' : ''}`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Chat agents
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="mcm-aisearch-i" />
                <input
                  type="text"
                  placeholder="Search agents…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mcm-aisearch"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isPageLoading ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2">
                  <Loader variant="custom" />
                  <p className="text-[11px] text-gray-400">Loading agents...</p>
                </div>
              ) : filteredAgents.length === 0 ? (
                <div className="py-8 px-4 text-center">
                  <p className="text-xs text-gray-500 font-medium">No agents found</p>
                </div>
              ) : (
                filteredAgents.map((agent: any) => {
                  const agentId = agent?.agent_uuid || agent?.id;
                  const isSelected =
                    selectedAgent &&
                    (selectedAgent?.agent_uuid === agentId || selectedAgent?.id === agentId);
                  // const isLive = String(agent?.status || agent?.agentStatus || '').toLowerCase() === 'live';

                  return (
                    <button
                      key={agentId}
                      onClick={() => handleSelectAgent(agent)}
                      aria-pressed={isSelected}
                      className={`mcm-pg-agent${isSelected ? ' is-on' : ''}`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CustomAvatar
                          name={agent?.agentName}
                          showPresence={false}
                          size="32"
                          isActivityInfo={false}
                        />
                        <div className="min-w-0">
                          <p className="mcm-pg-agentn">{agent?.agentName}</p>
                          <p className="mcm-pg-agentk">
                            {activeTab === 'chat' ? 'Chat agent' : 'Voice receptionist'}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Middle Column: Inline Sandbox Session */}
          <div className="mcm-pg-stage">
            {!selectedAgent ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto">
                <div className="mcm-pg-mark">
                  <Activity className="w-6 h-6" />
                </div>
                <h3 className="mcm-pg-blankt">Nothing running yet</h3>
                <p className="mcm-pg-blankd">
                  Pick an agent on the left. A chat opens straight away; a receptionist places a
                  test call to your browser.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 ">
                {/* Middle Column Header */}
                <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-3 bg-gray-50/30 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-bold text-sm uppercase shrink-0">
                      {String(selectedAgent?.agentName || 'A').charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-xs font-bold text-gray-900 truncate max-w-[120px]">
                          {selectedAgent?.agentName}
                        </h2>
                        {/* The agent's real status. This was the literal word
                            "Live" on every agent, so a paused receptionist was
                            announced as live in the one place you go to check
                            whether it works. The commented-out `isLive` line
                            in the list beside it shows the intent. */}
                        {(() => {
                          const state = String(
                            selectedAgent?.status || selectedAgent?.agentStatus || '',
                          ).toLowerCase();
                          const live = state === 'live' || state === 'active';
                          return (
                            <span className={`mcm-pg-state${live ? ' is-live' : ''}`}>
                              {live ? 'Live' : state ? state : 'Not live'}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-gray-500 leading-3">
                        <span>{activeTab === 'chat' ? 'Chat agent' : 'Voice receptionist'}</span>
                        <span>•</span>
                        <span className="text-primary font-semibold flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5" /> Sandbox mode
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Inline Sandbox Console */}
                <div className="flex-1 flex flex-col min-h-0 overflow-auto">
                  <div ref={containerRef} className="w-full flex-1 relative bg-gray-50/50">
                    <div id="ai-chat-widget-root" className="w-full h-full" />

                    {!activeWidgetKey ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-white z-10">
                        <p className="text-sm font-semibold text-gray-900">Widget key missing</p>
                        <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-500">
                          Save the agent widget configuration first, then test it here.
                        </p>
                      </div>
                    ) : !isWidgetActive ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-white z-10">
                        <Loader variant="custom" />
                        <p className="text-xs text-gray-500 mt-2">
                          Loading {activeWidgetMode === 'call' ? 'call' : 'chat'} widget inside
                          center layout...
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Playground;
