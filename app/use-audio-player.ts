"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AudioErrorKind = "network" | "decode" | "playback" | "unsupported";

export type AudioPlayerError = {
  kind: AudioErrorKind;
  message: string;
  path?: string;
};

export type AudioPlayRequest = {
  paths: string[];
  /** 与 paths 按下标对应的 WAV（波形音频）回退地址。 */
  fallbackPaths?: Array<string | undefined>;
  label: string;
  loop?: boolean;
  muted?: boolean[];
};

const MAX_AUDIO_CACHE_SIZE = 8;
const START_DELAY_SECONDS = 0.04;
const RESUME_TIMEOUT_MS = 2500;

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

type PlayerStatus = "idle" | "loading" | "playing" | "paused";

class AudioFailure extends Error {
  readonly kind: AudioErrorKind;
  readonly path?: string;

  constructor(kind: AudioErrorKind, message: string, path?: string) {
    super(message);
    this.name = "AudioFailure";
    this.kind = kind;
    this.path = path;
  }
}

class RequestAborted extends Error {
  constructor() {
    super("音频请求已取消");
    this.name = "RequestAborted";
  }
}

const resolveAsset = (path: string) =>
  new URL(path.replace(/^\//, ""), document.baseURI).toString();

function isAbortError(error: unknown) {
  return (
    error instanceof RequestAborted ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fallbackPathFor(path: string, fallback?: string) {
  if (fallback) return fallback;
  return /\.mp3(?:$|[?#])/i.test(path)
    ? path.replace(/\.mp3(?=($|[?#]))/i, ".wav")
    : undefined;
}

function isContextClosed(audioContext: AudioContext) {
  return String(audioContext.state) === "closed";
}

function isContextRunning(audioContext: AudioContext) {
  return String(audioContext.state) === "running";
}

function createPlayerError(error: unknown): AudioPlayerError {
  if (error instanceof AudioFailure) {
    return { kind: error.kind, message: error.message, path: error.path };
  }

  return {
    kind: "playback",
    message: `浏览器暂时阻止了播放，请点击“重试音频”后再试（${errorMessage(error)}）。`,
  };
}

/**
 * 通过一个 1 样本的静音缓冲区触发移动浏览器的音频解锁。
 * 必须在用户手势同步调用栈中执行，后续网络请求才不会错过 Safari（苹果浏览器）策略。
 */
function unlockContext(audioContext: AudioContext) {
  try {
    const silentBuffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    const silentSource = audioContext.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(audioContext.destination);
    silentSource.start(0);
  } catch {
    // 某些浏览器在上下文刚创建时拒绝静音源，但仍可能允许 resume；交给后续状态检查处理。
  }
}

function decodeAudioData(audioContext: AudioContext, data: ArrayBuffer) {
  // 旧版 iOS（苹果移动系统）实现曾只接受回调参数。这里同时兼容回调和 Promise（承诺）返回值。
  const decoder = audioContext.decodeAudioData.bind(audioContext) as unknown as (
    audioData: ArrayBuffer,
    successCallback?: (buffer: AudioBuffer) => void,
    errorCallback?: (error: DOMException) => void,
  ) => Promise<AudioBuffer> | void;

  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;
    const succeed = (buffer: AudioBuffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause);
    };

    try {
      const result = decoder(data, succeed, (cause) => fail(cause));
      if (result && typeof result.then === "function") {
        result.then(succeed).catch(fail);
      }
    } catch (cause) {
      fail(cause);
    }
  });
}

export function useAudioPlayer() {
  const context = useRef<AudioContext | null>(null);
  const resumePromise = useRef<Promise<void> | null>(null);
  const resumeError = useRef<unknown | null>(null);
  const cache = useRef(new Map<string, AudioBuffer>());
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const gains = useRef<GainNode[]>([]);
  const started = useRef(0);
  const offset = useRef(0);
  const duration = useRef(0);
  const request = useRef<AudioPlayRequest | null>(null);
  const timer = useRef<number | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  const status = useRef<PlayerStatus>("idle");
  const needsUnlock = useRef(false);
  const tickRef = useRef<(generation: number) => void>(() => undefined);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<AudioPlayerError | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      cancelAnimationFrame(timer.current);
      timer.current = null;
    }
  }, []);

  const stopNodes = useCallback(() => {
    sources.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // 已结束的 AudioBufferSourceNode（音频缓冲源节点）会抛异常，忽略即可。
      }
    });
    sources.current = [];
    gains.current = [];
  }, []);

  const clearCache = useCallback(() => {
    cache.current.clear();
  }, []);

  const isCurrentRequest = useCallback((generation: number) => {
    return generation === requestGeneration.current;
  }, []);

  const getContext = useCallback(() => {
    if (context.current && !isContextClosed(context.current)) {
      if (needsUnlock.current) {
        unlockContext(context.current);
        needsUnlock.current = false;
      }
      return context.current;
    }

    const browserWindow = window as WebkitWindow;
    const AudioContextConstructor = window.AudioContext ?? browserWindow.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new AudioFailure("unsupported", "当前浏览器不支持网页音频播放，请更换 Safari 或 Chrome。");
    }

    try {
      const nextContext = new AudioContextConstructor();
      context.current = nextContext;
      resumePromise.current = null;
      resumeError.current = null;
      unlockContext(nextContext);
      needsUnlock.current = false;
      return nextContext;
    } catch (cause) {
      throw new AudioFailure(
        "playback",
        `音频播放初始化失败，请点击“重试音频”后再试（${errorMessage(cause)}）。`,
      );
    }
  }, []);

  const requestContextResume = useCallback((audioContext: AudioContext) => {
    if (isContextRunning(audioContext)) return Promise.resolve();

    resumeError.current = null;
    try {
      const result = audioContext.resume();
      const pending = Promise.resolve(result).then(
        () => undefined,
        (cause) => {
          resumeError.current = cause;
          throw cause;
        },
      );
      resumePromise.current = pending;
      return pending;
    } catch (cause) {
      resumeError.current = cause;
      return Promise.reject(cause);
    }
  }, []);

  const waitForContext = useCallback(
    async (audioContext: AudioContext, generation: number) => {
      if (!isCurrentRequest(generation)) throw new RequestAborted();

      const pending = requestContextResume(audioContext);
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new AudioFailure("playback", "浏览器没有及时恢复音频，请点击“重试音频”后再试。")),
              RESUME_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (cause) {
        if (!isCurrentRequest(generation)) throw new RequestAborted();
        if (resumeError.current) {
          throw new AudioFailure(
            "playback",
            `浏览器暂时阻止了播放，请点击“重试音频”后再试（${errorMessage(resumeError.current)}）。`,
          );
        }
        throw cause;
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }

      if (!isCurrentRequest(generation)) throw new RequestAborted();
      if (!isContextRunning(audioContext)) {
        throw new AudioFailure("playback", "浏览器暂时阻止了播放，请点击“重试音频”后再试。");
      }
    },
    [isCurrentRequest, requestContextResume],
  );

  const touchCache = useCallback((url: string, buffer: AudioBuffer) => {
    cache.current.delete(url);
    cache.current.set(url, buffer);
    while (cache.current.size > MAX_AUDIO_CACHE_SIZE) {
      const oldest = cache.current.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.current.delete(oldest);
    }
  }, []);

  const loadBuffer = useCallback(
    async (path: string, audioContext: AudioContext, signal: AbortSignal) => {
      const url = resolveAsset(path);
      const cached = cache.current.get(url);
      if (cached) {
        // Map（映射）按访问顺序维护，重新插入即可更新 LRU（最近最少使用）顺序。
        touchCache(url, cached);
        return cached;
      }

      let response: Response;
      try {
        response = await fetch(url, { signal });
      } catch (cause) {
        if (isAbortError(cause) || signal.aborted) throw new RequestAborted();
        throw new AudioFailure("network", `音频资源加载失败，请检查网络后重试（${errorMessage(cause)}）。`, path);
      }

      if (!response.ok) {
        throw new AudioFailure("network", `音频资源加载失败（HTTP ${response.status}），请重试。`, path);
      }

      let data: ArrayBuffer;
      try {
        data = await response.arrayBuffer();
      } catch (cause) {
        if (isAbortError(cause) || signal.aborted) throw new RequestAborted();
        throw new AudioFailure("network", `音频数据读取失败，请检查网络后重试（${errorMessage(cause)}）。`, path);
      }

      let buffer: AudioBuffer;
      try {
        buffer = await decodeAudioData(audioContext, data);
      } catch (cause) {
        if (signal.aborted) throw new RequestAborted();
        throw new AudioFailure("decode", `音频解码失败，当前浏览器可能不支持该格式（${errorMessage(cause)}）。`, path);
      }

      if (signal.aborted) throw new RequestAborted();
      touchCache(url, buffer);
      return buffer;
    },
    [touchCache],
  );

  const loadTrack = useCallback(
    async (
      path: string,
      fallback: string | undefined,
      audioContext: AudioContext,
      signal: AbortSignal,
    ) => {
      try {
        return await loadBuffer(path, audioContext, signal);
      } catch (primaryCause) {
        if (isAbortError(primaryCause)) throw primaryCause;

        const fallbackPath = fallbackPathFor(path, fallback);
        if (!fallbackPath || fallbackPath === path) throw primaryCause;

        try {
          return await loadBuffer(fallbackPath, audioContext, signal);
        } catch (fallbackCause) {
          if (isAbortError(fallbackCause)) throw fallbackCause;
          // 任一格式解码失败通常意味着浏览器能力不足，优先向用户报告解码类错误。
          if (
            primaryCause instanceof AudioFailure &&
            fallbackCause instanceof AudioFailure &&
            (primaryCause.kind === "decode" || fallbackCause.kind === "decode")
          ) {
            throw new AudioFailure(
              "decode",
              "MP3 与 WAV 均无法解码，当前浏览器可能不支持该音频格式，请重试或更换浏览器。",
              path,
            );
          }
          throw new AudioFailure("network", "MP3 与 WAV 音频均加载失败，请检查网络后重试。", path);
        }
      }
    },
    [loadBuffer],
  );

  const tick = useCallback(
    (generation: number) => {
      if (!isCurrentRequest(generation) || !context.current || !request.current) return;

      const elapsed = context.current.currentTime - started.current + offset.current;
      const currentDuration = duration.current;
      const loop = Boolean(request.current.loop);
      const position = loop && currentDuration
        ? ((elapsed % currentDuration) + currentDuration) % currentDuration
        : Math.min(Math.max(elapsed, 0), currentDuration);

      setProgress(currentDuration ? position / currentDuration : 0);
      if (currentDuration > 0 && elapsed >= currentDuration && !loop) {
        stopNodes();
        clearTimer();
        status.current = "idle";
        setPlaying(false);
        setProgress(1);
        return;
      }

      timer.current = requestAnimationFrame(() => tickRef.current(generation));
    },
    [clearTimer, isCurrentRequest, stopNodes],
  );

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const start = useCallback(
    async (nextRequest: AudioPlayRequest, startOffset = 0) => {
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      abortController.current?.abort();
      const controller = new AbortController();
      abortController.current = controller;
      request.current = {
        ...nextRequest,
        paths: nextRequest.paths.slice(),
        fallbackPaths: nextRequest.fallbackPaths?.slice(),
      };
      status.current = "loading";
      setError(null);
      setLoading(true);
      setPlaying(false);
      setProgress(0);
      setLabel(nextRequest.label);
      clearTimer();
      stopNodes();

      try {
        // getContext 和 unlockContext 必须位于用户点击触发的同步段；下面才开始 await。
        const audioContext = getContext();
        await waitForContext(audioContext, generation);
        if (!isCurrentRequest(generation)) throw new RequestAborted();

        const buffers = await Promise.all(
          nextRequest.paths.map((path, index) =>
            loadTrack(path, nextRequest.fallbackPaths?.[index], audioContext, controller.signal),
          ),
        );
        if (!isCurrentRequest(generation) || controller.signal.aborted) throw new RequestAborted();
        if (buffers.length === 0) throw new AudioFailure("decode", "没有可播放的音频声部。");

        const nextDuration = Math.min(...buffers.map((buffer) => buffer.duration));
        if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
          throw new AudioFailure("decode", "音频时长无效，无法开始播放。");
        }

        duration.current = nextDuration;
        const safeOffset = Math.max(0, Math.min(startOffset, Math.max(0, nextDuration - 0.001)));
        offset.current = safeOffset;
        started.current = audioContext.currentTime + START_DELAY_SECONDS;

        const nextSources: AudioBufferSourceNode[] = [];
        const nextGains: GainNode[] = [];
        try {
          buffers.forEach((buffer, index) => {
            const source = audioContext.createBufferSource();
            const gain = audioContext.createGain();
            source.buffer = buffer;
            source.loop = Boolean(nextRequest.loop);
            if (source.loop) source.loopEnd = nextDuration;
            gain.gain.value = nextRequest.muted?.[index] ? 0 : 1;
            source.connect(gain).connect(audioContext.destination);
            nextSources.push(source);
            nextGains.push(gain);
          });
          nextSources.forEach((source) => source.start(started.current, safeOffset));
        } catch (cause) {
          nextSources.forEach((source) => {
            try {
              source.stop();
            } catch {
              // 部分节点可能已经停止。
            }
          });
          throw new AudioFailure("playback", `音频节点启动失败，请点击“重试音频”后再试（${errorMessage(cause)}）。`);
        }

        if (!isCurrentRequest(generation)) {
          nextSources.forEach((source) => {
            try {
              source.stop();
            } catch {
              // 请求已经过期。
            }
          });
          throw new RequestAborted();
        }

        sources.current = nextSources;
        gains.current = nextGains;
        status.current = "playing";
        setProgress(safeOffset / nextDuration);
        setPlaying(true);
        clearTimer();
        timer.current = requestAnimationFrame(() => tick(generation));
      } catch (cause) {
        if (!isCurrentRequest(generation) || isAbortError(cause)) return;
        status.current = "idle";
        setPlaying(false);
        setError(createPlayerError(cause));
        console.error("音频播放失败", cause);
      } finally {
        if (isCurrentRequest(generation)) setLoading(false);
      }
    },
    [clearTimer, getContext, isCurrentRequest, loadTrack, stopNodes, tick, waitForContext],
  );

  const play = useCallback((nextRequest: AudioPlayRequest) => {
    void start(nextRequest, 0);
  }, [start]);

  const pause = useCallback(() => {
    if (status.current !== "playing" || !context.current || duration.current <= 0) return;

    const elapsed = context.current.currentTime - started.current + offset.current;
    const loop = Boolean(request.current?.loop);
    const nextOffset = loop
      ? ((elapsed % duration.current) + duration.current) % duration.current
      : Math.min(Math.max(elapsed, 0), duration.current);
    offset.current = nextOffset;
    stopNodes();
    clearTimer();
    status.current = "paused";
    setPlaying(false);
    setProgress(duration.current ? nextOffset / duration.current : 0);
  }, [clearTimer, stopNodes]);

  const resume = useCallback(() => {
    if (!request.current || status.current === "loading" || status.current === "playing") return;
    const resumeOffset = status.current === "paused" ? offset.current : 0;
    void start(request.current, resumeOffset);
  }, [start]);

  const retry = useCallback(() => {
    if (!request.current || status.current === "loading" || status.current === "playing") return;
    const retryOffset = status.current === "paused" ? offset.current : 0;
    void start(request.current, retryOffset);
  }, [start]);

  const stop = useCallback(() => {
    requestGeneration.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    stopNodes();
    clearTimer();
    clearCache();
    offset.current = 0;
    duration.current = 0;
    request.current = null;
    status.current = "idle";
    needsUnlock.current = false;
    setError(null);
    setLoading(false);
    setPlaying(false);
    setProgress(0);
    setLabel("");
  }, [clearCache, clearTimer, stopNodes]);

  const updateMuted = useCallback((muted: boolean[]) => {
    if (request.current) request.current = { ...request.current, muted: muted.slice() };
    gains.current.forEach((gain, index) => {
      gain.gain.value = muted[index] ? 0 : 1;
    });
  }, []);

  useEffect(() => {
    const markContextForUnlock = () => {
      const audioContext = context.current;
      if (audioContext && !isContextRunning(audioContext) && !isContextClosed(audioContext)) {
        needsUnlock.current = true;
      }
    };

    document.addEventListener("visibilitychange", markContextForUnlock);
    window.addEventListener("pageshow", markContextForUnlock);
    return () => {
      document.removeEventListener("visibilitychange", markContextForUnlock);
      window.removeEventListener("pageshow", markContextForUnlock);
    };
  }, []);

  useEffect(() => () => {
    requestGeneration.current += 1;
    abortController.current?.abort();
    stopNodes();
    clearTimer();
    clearCache();
    const audioContext = context.current;
    if (audioContext && !isContextClosed(audioContext)) void audioContext.close();
  }, [clearCache, clearTimer, stopNodes]);

  return {
    play,
    pause,
    resume,
    stop,
    retry,
    updateMuted,
    playing,
    loading,
    progress,
    label,
    error,
  };
}
