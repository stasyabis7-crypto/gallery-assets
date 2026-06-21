/**
 * Media Gallery — Semplice override
 *
 * Самодостаточный скрипт. Подключи ПОСЛЕ React/ReactDOM или
 * не подключай React отдельно — скрипт сам подгружает его с CDN,
 * если window.React/window.ReactDOM ещё не определены.
 *
 * Использование (в любом порядке):
 *   <link rel="stylesheet" href="gallery.css" />
 *   <script src="gallery.js" defer></script>
 *
 * После загрузки доступен глобальный API:
 *   window.MediaGallery.open(items, startIndex)   // открыть fullscreen
 *   window.MediaGallery.mount(el, items, options) // монтировать inline
 */
(function () {
  'use strict';

  // ─── 1. Загрузка React с CDN (если ещё нет) ────────────────────────────
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  var reactReady = (window.React && window.ReactDOM)
    ? Promise.resolve()
    : loadScript('https://unpkg.com/react@18/umd/react.production.min.js')
        .then(function () {
          return loadScript('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js');
        });

  reactReady.then(init);

  // ─── 2. Инициализация после загрузки React ─────────────────────────────
  function init() {
    var React = window.React;
    var ReactDOM = window.ReactDOM;
    var h = React.createElement;
    var createPortal = ReactDOM.createPortal;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useMemo = React.useMemo;
    var useCallback = React.useCallback;

    // ── Иконки (SVG inline) ──────────────────────────────────────────────
    function IconChevronLeft() {
      return h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('polyline', { points: '15 18 9 12 15 6' }));
    }
    function IconChevronRight() {
      return h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('polyline', { points: '9 18 15 12 9 6' }));
    }
    function IconPlay() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'currentColor', stroke: 'none' },
        h('polygon', { points: '5 3 19 12 5 21 5 3' }));
    }
    function IconX() {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
        h('line', { x1: 6, y1: 6, x2: 18, y2: 18 }));
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    var clamp = function (v, min, max) { return Math.min(Math.max(v, min), max); };
    var isMobile = function () { return window.matchMedia('(max-width: 767px)').matches; };

    // ── Thumbnails ───────────────────────────────────────────────────────
    function Thumbnails(props) {
      var items = props.items, activeIndex = props.activeIndex,
          setActiveIndex = props.setActiveIndex, placement = props.placement;
      var thumbsRef = props.thumbsRef, thumbRefs = props.thumbRefs;

      return h('div', {
        ref: thumbsRef,
        className: 'media-gallery__thumbs' + (placement === 'side' ? ' media-gallery__thumbs_side' : ''),
        'aria-label': 'Миниатюры'
      }, items.map(function (item, i) {
        var thumb = item.type === 'video'
          ? (item.thumbnailSrc || item.poster || null)
          : (item.thumbnailSrc || item.src);
        return h('button', {
          key: item.id,
          ref: function (node) { thumbRefs.current[i] = node; },
          className: 'media-gallery__thumb' + (i === activeIndex ? ' media-gallery__thumb_selected' : ''),
          type: 'button',
          'aria-label': 'Медиа ' + (i + 1),
          'aria-current': i === activeIndex,
          onClick: function () { setActiveIndex(i); }
        },
          thumb ? h('img', { src: thumb, alt: '' }) : h('span', { className: 'media-gallery__thumb-placeholder' }),
          item.type === 'video' && h('span', { className: 'media-gallery__play', 'aria-hidden': 'true' }, h(IconPlay))
        );
      }));
    }

    // ── GallerySurface ───────────────────────────────────────────────────
    function GallerySurface(props) {
      var items = props.items, activeIndex = props.activeIndex,
          setActiveIndex = props.setActiveIndex,
          previous = props.previous, next = props.next,
          hasSeveralItems = props.hasSeveralItems,
          showThumbnails = props.showThumbnails,
          videoRefs = props.videoRefs,
          ariaLabel = props.ariaLabel,
          onKeyDown = props.onKeyDown,
          isPopup = props.isPopup,
          onClose = props.onClose,
          onViewportClick = props.onViewportClick,
          thumbnailsPlacement = props.thumbnailsPlacement || 'bottom',
          naturalSize = props.naturalSize || false,
          className = props.className || '';

      var thumbsRef = useRef(null);
      var thumbRefs = useRef([]);
      var viewportRef = useRef(null);
      var suppressClickRef = useRef(false);
      var pointersRef = useRef({});   // { pointerId: { x, y } }
      var gestureRef = useRef(null);  // current gesture state
      var [dragOffset, setDragOffset] = useState(0);
      var [closeDragOffset, setCloseDragOffset] = useState(0);
      var [loadedImages, setLoadedImages] = useState({});
      var [zoom, setZoom] = useState(1);
      var [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
      var [frameAspect, setFrameAspect] = useState(null);
      var isFullscreen = className.indexOf('media-gallery_fullscreen') !== -1;

      // Scroll active thumbnail into view
      useEffect(function () {
        var container = thumbsRef.current;
        var activeThumb = thumbRefs.current[activeIndex];
        if (!container || !activeThumb) return;
        var cr = container.getBoundingClientRect();
        var tr = activeThumb.getBoundingClientRect();
        if (thumbnailsPlacement === 'side') {
          if (tr.top < cr.top || tr.bottom > cr.bottom)
            activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          return;
        }
        if (tr.left < cr.left || tr.right > cr.right)
          activeThumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }, [activeIndex, thumbnailsPlacement]);

      // Reset zoom + frameAspect when slide changes
      useEffect(function () {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
        pointersRef.current = {};
        gestureRef.current = null;
        setDragOffset(0);
        setCloseDragOffset(0);
        if (naturalSize) setFrameAspect(null);
      }, [activeIndex]);

      // Non-passive wheel listener for zoom (React adds passive by default)
      useEffect(function () {
        if (!isFullscreen) return;
        var el = viewportRef.current;
        if (!el) return;
        function onWheel(e) {
          e.preventDefault();
          var factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
          setZoom(function (z) {
            var nz = clamp(z * factor, 1, 4);
            if (nz <= 1.02) { setPanOffset({ x: 0, y: 0 }); return 1; }
            return nz;
          });
        }
        el.addEventListener('wheel', onWheel, { passive: false });
        return function () { el.removeEventListener('wheel', onWheel); };
      }, [isFullscreen]);

      function clampPan(x, y, z) {
        var el = viewportRef.current;
        if (!el || z <= 1) return { x: 0, y: 0 };
        var maxX = el.offsetWidth * (z - 1) / 2;
        var maxY = el.offsetHeight * (z - 1) / 2;
        return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
      }

      function handlePointerDown(e) {
        pointersRef.current[e.pointerId] = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        var ids = Object.keys(pointersRef.current);

        if (ids.length >= 2) {
          // Start pinch
          var pts = Object.values(pointersRef.current);
          var dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          gestureRef.current = { type: 'pinch', startDist: dist, startZoom: zoom,
            startPanX: panOffset.x, startPanY: panOffset.y };
          setDragOffset(0);
        } else {
          gestureRef.current = {
            type: 'pending',
            pointerId: e.pointerId,
            startX: e.clientX, startY: e.clientY,
            currentX: e.clientX,
            startPanX: panOffset.x, startPanY: panOffset.y
          };
        }
      }

      function handlePointerMove(e) {
        if (!pointersRef.current[e.pointerId]) return;
        pointersRef.current[e.pointerId] = { x: e.clientX, y: e.clientY };
        var gesture = gestureRef.current;
        if (!gesture) return;
        var ids = Object.keys(pointersRef.current);

        if (ids.length >= 2 && gesture.type === 'pinch') {
          var pts = Object.values(pointersRef.current);
          var dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          var newZoom = clamp(gesture.startZoom * (dist / gesture.startDist), 1, 4);
          setZoom(newZoom);
          if (newZoom <= 1) setPanOffset({ x: 0, y: 0 });
          else setPanOffset(function (p) { return clampPan(p.x, p.y, newZoom); });
          return;
        }

        if (gesture.pointerId !== e.pointerId) return;
        var dx = e.clientX - gesture.startX;
        var dy = e.clientY - gesture.startY;
        gesture.currentX = e.clientX;

        // Determine gesture type on first significant move
        if (gesture.type === 'pending' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
          var axisHoriz = Math.abs(dx) > Math.abs(dy);
          if (zoom > 1 && isFullscreen) {
            gesture.type = 'pan';
          } else if (axisHoriz && hasSeveralItems) {
            gesture.type = 'swipe';
          } else if (!axisHoriz && isFullscreen && onClose && isMobile()) {
            gesture.type = 'close-drag';
          } else {
            gesture.type = 'idle';
          }
        }

        if (gesture.type === 'pan') {
          suppressClickRef.current = true;
          setPanOffset(clampPan(gesture.startPanX + dx, gesture.startPanY + dy, zoom));
        } else if (gesture.type === 'swipe') {
          var isFirst = activeIndex === 0, isLast = activeIndex === items.length - 1;
          var resisted = (isFirst && dx > 0) || (isLast && dx < 0) ? dx * 0.32 : dx;
          suppressClickRef.current = true;
          setDragOffset(resisted);
        } else if (gesture.type === 'close-drag') {
          if (dy > 0) { suppressClickRef.current = true; setCloseDragOffset(dy); }
        }
      }

      function finishPointer(e) {
        var gesture = gestureRef.current;
        if (gesture) {
          if (gesture.type === 'swipe') {
            var dx = gesture.currentX - gesture.startX;
            if (Math.abs(dx) > 54) {
              if (dx < 0 && activeIndex < items.length - 1) next();
              if (dx > 0 && activeIndex > 0) previous();
            }
            setDragOffset(0);
            if (Math.abs(dx) > 8) {
              suppressClickRef.current = true;
              setTimeout(function () { suppressClickRef.current = false; }, 0);
            }
          } else if (gesture.type === 'close-drag') {
            var dy = e.clientY - gesture.startY;
            if (dy > 96 && onClose) onClose();
            setCloseDragOffset(0);
          } else if (gesture.type === 'pan') {
            suppressClickRef.current = true;
            setTimeout(function () { suppressClickRef.current = false; }, 0);
          }
        }

        delete pointersRef.current[e.pointerId];
        var remaining = Object.keys(pointersRef.current).length;
        if (remaining === 0) {
          gestureRef.current = null;
        } else if (remaining === 1 && gesture && gesture.type === 'pinch') {
          // One finger lifted after pinch — set up pan state
          var remainId = Object.keys(pointersRef.current)[0];
          var pt = pointersRef.current[remainId];
          gestureRef.current = {
            type: 'pending', pointerId: remainId,
            startX: pt.x, startY: pt.y, currentX: pt.x,
            startPanX: panOffset.x, startPanY: panOffset.y
          };
        }
      }

      // ── Mouse drag (desktop) — отдельный обработчик для мыши при зуме ──
      var mouseDragRef = useRef(null);

      function handleMouseDown(e) {
        if (!isFullscreen || zoom <= 1 || e.button !== 0) return;
        var startX = e.clientX, startY = e.clientY;
        var startPanX = panOffset.x, startPanY = panOffset.y;
        mouseDragRef.current = true;

        function onMove(ev) {
          var dx = ev.clientX - startX;
          var dy = ev.clientY - startY;
          setPanOffset(clampPan(startPanX + dx, startPanY + dy, zoom));
        }
        function onUp() {
          mouseDragRef.current = null;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }

      // Double-tap / double-click: toggle zoom 1x ↔ 2x
      var lastTapRef = useRef(0);
      function handleViewportClick(e) {
        if (suppressClickRef.current) return;
        if (isFullscreen) {
          var now = Date.now();
          if (now - lastTapRef.current < 300) {
            lastTapRef.current = 0;
            setZoom(function (z) {
              if (z > 1.05) { setPanOffset({ x: 0, y: 0 }); return 1; }
              return 2;
            });
          } else {
            lastTapRef.current = now;
          }
          return;
        }
        if (onViewportClick) onViewportClick();
      }

      var thumbsProps = { items: items, activeIndex: activeIndex, setActiveIndex: setActiveIndex,
        thumbsRef: thumbsRef, thumbRefs: thumbRefs, placement: thumbnailsPlacement };

      var isDraggingNow = (gestureRef.current && gestureRef.current.type === 'pan') || !!mouseDragRef.current;
      var vpCursor = isFullscreen
        ? (zoom > 1 ? (isDraggingNow ? 'grabbing' : 'grab') : 'zoom-in')
        : (onViewportClick ? 'pointer' : 'default');

      return h('div', {
        className: 'media-gallery' + (isPopup ? ' media-gallery_popup' : '') + (closeDragOffset ? ' media-gallery_close_dragging' : '') + (className ? ' ' + className : ''),
        style: closeDragOffset ? { opacity: Math.max(0.52, 1 - closeDragOffset / 360), transform: 'translateY(' + closeDragOffset + 'px) scale(' + Math.max(0.92, 1 - closeDragOffset / 2200) + ')' } : undefined,
        'aria-label': ariaLabel, role: 'region', tabIndex: 0, onKeyDown: onKeyDown
      },
        onClose && h('button', { className: 'media-gallery__close', type: 'button', 'aria-label': 'Закрыть', onClick: onClose }, h(IconX)),
        h('div', { className: 'media-gallery__layout' + (showThumbnails && thumbnailsPlacement === 'side' ? ' media-gallery__layout_with_side_thumbs' : '') },
          showThumbnails && thumbnailsPlacement === 'side' && h(Thumbnails, thumbsProps),
          h('div', { className: 'media-gallery__frame',
            style: naturalSize ? { aspectRatio: frameAspect ? String(frameAspect) : 'auto', height: frameAspect ? undefined : 'auto' } : undefined },
            h('div', {
              ref: viewportRef,
              className: 'media-gallery__viewport',
              style: { cursor: vpCursor, touchAction: isFullscreen && zoom > 1 ? 'none' : undefined, userSelect: 'none', WebkitUserSelect: 'none' },
              role: onViewportClick ? 'button' : undefined,
              'aria-label': onViewportClick ? 'Открыть полноэкранно' : undefined,
              tabIndex: onViewportClick ? 0 : -1,
              onClick: handleViewportClick,
              onMouseDown: handleMouseDown,
              onPointerDown: handlePointerDown,
              onPointerMove: handlePointerMove,
              onPointerUp: finishPointer,
              onPointerCancel: finishPointer,
              onKeyDown: function (e) {
                if (!onViewportClick) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewportClick(); }
              }
            },
              h('div', {
                className: 'media-gallery__track' + (dragOffset ? ' media-gallery__track_dragging' : ''),
                style: { transform: 'translateX(calc(' + (-activeIndex * 100) + '% + ' + dragOffset + 'px))' }
              }, items.map(function (item, idx) {
                var isActiveSlide = idx === activeIndex;
                var zoomTransform = isFullscreen && isActiveSlide && zoom !== 1
                  ? 'translate(' + panOffset.x + 'px, ' + panOffset.y + 'px) scale(' + zoom + ')'
                  : undefined;

                return h('div', {
                  className: 'media-gallery__slide' + (item.type === 'image' && !loadedImages[item.id] ? ' media-gallery__slide_loading' : ''),
                  key: item.id, 'aria-hidden': idx !== activeIndex
                },
                  h('div', {
                    style: {
                      width: '100%', height: '100%',
                      transform: zoomTransform,
                      transformOrigin: 'center',
                      transition: gestureRef.current ? 'none' : 'transform 0.12s ease',
                      willChange: zoomTransform ? 'transform' : undefined
                    }
                  },
                    item.type === 'image' ? [
                      h('div', { key: 'bd', className: 'media-gallery__image-backdrop', 'aria-hidden': 'true', style: { backgroundImage: 'url(' + item.src + ')' } }),
                      h('img', { key: 'img', className: 'media-gallery__image', src: item.src, alt: item.alt || '',
                        draggable: false,
                        onDragStart: function(e) { e.preventDefault(); },
                        style: naturalSize ? { objectFit: 'contain', width: '100%', height: '100%' } : undefined,
                        onLoad: (function(capturedIdx, capturedId) { return function (e) {
                          setLoadedImages(function (cur) { var n = Object.assign({}, cur); n[capturedId] = true; return n; });
                          if (naturalSize && capturedIdx === activeIndex && e.target.naturalWidth) {
                            setFrameAspect(e.target.naturalWidth / e.target.naturalHeight);
                          }
                        }; })(idx, item.id) }),
                      onViewportClick && h('button', { key: 'fs', className: 'media-gallery__open-fullscreen', type: 'button', 'aria-label': 'Полный экран',
                        onClick: function (e) { e.stopPropagation(); handleViewportClick(); } })
                    ] : h('div', { className: 'media-gallery__video-wrap' },
                      h('video', {
                        ref: function (node) { videoRefs.current[idx] = node; },
                        className: 'media-gallery__video', src: item.src, poster: item.poster,
                        controls: true, muted: true, playsInline: true, preload: 'metadata'
                      }),
                      onViewportClick && h('button', { className: 'media-gallery__open-fullscreen', type: 'button', 'aria-label': 'Полный экран',
                        onClick: function (e) { e.stopPropagation(); handleViewportClick(); } })
                    )
                  )
                );
              }))
            ),
            hasSeveralItems && [
              h('button', { key: 'prev', className: 'media-gallery__arrow media-gallery__arrow_previous', type: 'button', 'aria-label': 'Назад', disabled: activeIndex === 0, onClick: previous },
                h('span', { className: 'media-gallery__arrow-icon' }, h(IconChevronLeft))),
              h('button', { key: 'next', className: 'media-gallery__arrow media-gallery__arrow_next', type: 'button', 'aria-label': 'Вперёд', disabled: activeIndex === items.length - 1, onClick: next },
                h('span', { className: 'media-gallery__arrow-icon' }, h(IconChevronRight))),
              h('div', { key: 'cnt', className: 'media-gallery__counter' }, (activeIndex + 1) + ' / ' + items.length)
            ]
          ),
          showThumbnails && thumbnailsPlacement === 'bottom' && h(Thumbnails, thumbsProps)
        )
      );
    }

    // ── MediaGallery component ───────────────────────────────────────────
    function MediaGallery(props) {
      var items = (props.items || []).filter(Boolean);
      var initialIndex = props.initialIndex || 0;
      var previewMode = props.previewMode || 'thumbnails';
      var ariaLabel = props.ariaLabel || 'Галерея';
      var naturalSize = props.naturalSize || false;

      var [activeIndex, setActiveIndex] = useState(function () { return clamp(initialIndex, 0, Math.max(items.length - 1, 0)); });
      var [fullscreenOpen, setFullscreenOpen] = useState(false);
      var videoRefs = useRef([]);
      var fsVideoRefs = useRef([]);
      var hasSeveral = items.length > 1;
      var showThumbs = previewMode === 'thumbnails' && hasSeveral;

      useEffect(function () {
        videoRefs.current.forEach(function (v, i) {
          if (!v) return;
          if (i !== activeIndex) { v.pause(); return; }
          v.play && v.play().catch(function () {});
        });
        fsVideoRefs.current.forEach(function (v, i) {
          if (!v) return;
          if (i !== activeIndex || !fullscreenOpen) { v.pause(); return; }
          v.play && v.play().catch(function () {});
        });
      }, [activeIndex, fullscreenOpen]);

      useEffect(function () {
        if (!fullscreenOpen) fsVideoRefs.current.forEach(function (v) { v && v.pause(); });
      }, [fullscreenOpen]);

      function selectIndex(i) { setActiveIndex(clamp(i, 0, Math.max(items.length - 1, 0))); }
      function previous() { selectIndex(activeIndex - 1); }
      function next() { selectIndex(activeIndex + 1); }

      function handleKeyDown(e) {
        if (e.key === 'Escape' && fullscreenOpen) { e.preventDefault(); setFullscreenOpen(false); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); previous(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      }

      if (!items.length) return h('div', { className: 'media-gallery', 'aria-label': ariaLabel },
        h('div', { className: 'media-gallery__empty' }, 'Медиа не добавлены'));

      var surfaceProps = {
        items: items, activeIndex: activeIndex, setActiveIndex: selectIndex,
        previous: previous, next: next, hasSeveralItems: hasSeveral,
        showThumbnails: showThumbs, ariaLabel: ariaLabel, onKeyDown: handleKeyDown
      };

      return h(React.Fragment, null,
        h(GallerySurface, Object.assign({}, surfaceProps, {
          videoRefs: videoRefs, isPopup: false, naturalSize: naturalSize,
          onViewportClick: function () { setFullscreenOpen(true); }
        })),
        fullscreenOpen && createPortal(
          h('div', { className: 'mg-fullscreen', role: 'presentation', onMouseDown: function () { setFullscreenOpen(false); } },
            h('div', { className: 'mg-fullscreen__dialog', role: 'dialog', 'aria-modal': 'true', onMouseDown: function (e) { e.stopPropagation(); } },
              h(GallerySurface, Object.assign({}, surfaceProps, {
                videoRefs: fsVideoRefs, isPopup: true,
                onClose: function () { setFullscreenOpen(false); },
                thumbnailsPlacement: 'side', className: 'media-gallery_fullscreen'
              }))
            )
          ), document.body)
      );
    }

    // ── FullscreenGallery: standalone popup ──────────────────────────────
    // Используется для window.MediaGallery.open(items, startIndex)
    function FullscreenGallery(props) {
      var items = props.items, initialIndex = props.initialIndex || 0, onClose = props.onClose;
      var [activeIndex, setActiveIndex] = useState(initialIndex);
      var videoRefs = useRef([]);
      var hasSeveral = items.length > 1;

      useEffect(function () {
        videoRefs.current.forEach(function (v, i) {
          if (!v) return;
          if (i !== activeIndex) { v.pause(); return; }
          v.play && v.play().catch(function () {});
        });
      }, [activeIndex]);

      useEffect(function () {
        function handler(e) {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          if (e.key === 'ArrowLeft') { setActiveIndex(function (i) { return clamp(i - 1, 0, items.length - 1); }); }
          if (e.key === 'ArrowRight') { setActiveIndex(function (i) { return clamp(i + 1, 0, items.length - 1); }); }
        }
        document.addEventListener('keydown', handler);
        return function () { document.removeEventListener('keydown', handler); };
      }, [items.length, onClose]);

      return createPortal(
        h('div', { className: 'mg-fullscreen', role: 'presentation', onMouseDown: onClose },
          h('div', { className: 'mg-fullscreen__dialog', role: 'dialog', 'aria-modal': 'true', onMouseDown: function (e) { e.stopPropagation(); } },
            h(GallerySurface, {
              items: items, activeIndex: activeIndex, setActiveIndex: setActiveIndex,
              previous: function () { setActiveIndex(function (i) { return clamp(i - 1, 0, items.length - 1); }); },
              next: function () { setActiveIndex(function (i) { return clamp(i + 1, 0, items.length - 1); }); },
              hasSeveralItems: hasSeveral, showThumbnails: hasSeveral, videoRefs: videoRefs,
              ariaLabel: 'Галерея', onKeyDown: function () {}, isPopup: true,
              onClose: onClose, thumbnailsPlacement: 'side', className: 'media-gallery_fullscreen'
            })
          )
        ), document.body);
    }

    // ── GlobalOverlay — синглтон для window.MediaGallery.open() ──────────
    var overlayRoot = null;
    var overlayReactRoot = null;

    function ensureOverlayRoot() {
      if (!overlayRoot) {
        overlayRoot = document.createElement('div');
        overlayRoot.id = 'media-gallery-overlay-root';
        document.body.appendChild(overlayRoot);
        overlayReactRoot = ReactDOM.createRoot(overlayRoot);
      }
    }

    function GlobalController() {
      var [state, setState] = useState(null); // { items, initialIndex }
      GlobalController._setState = setState;

      if (!state) return null;
      return h(FullscreenGallery, {
        items: state.items,
        initialIndex: state.initialIndex || 0,
        onClose: function () { setState(null); }
      });
    }
    GlobalController._setState = function () {};

    function mountGlobalController() {
      ensureOverlayRoot();
      overlayReactRoot.render(h(GlobalController));
    }

    // ── Public API ───────────────────────────────────────────────────────
    window.MediaGallery = {
      /**
       * Открыть галерею поверх страницы (fullscreen overlay).
       * @param {Array} items  — массив MediaGalleryItem
       * @param {number} startIndex — с какого слайда начать
       */
      open: function (items, startIndex) {
        mountGlobalController();
        GlobalController._setState({ items: items, initialIndex: startIndex || 0 });
      },

      /**
       * Смонтировать inline-галерею внутрь DOM-элемента.
       * @param {Element} el — куда монтировать
       * @param {Array}   items — массив MediaGalleryItem
       * @param {Object}  options — { previewMode: 'thumbnails'|'none' }
       * @returns {{ unmount: Function }} — для демонтирования
       */
      mount: function (el, items, options) {
        var opts = options || {};
        var root = ReactDOM.createRoot(el);
        root.render(h(MediaGallery, {
          items: items,
          previewMode: opts.previewMode || 'thumbnails',
          ariaLabel: opts.ariaLabel || 'Галерея',
          naturalSize: opts.naturalSize || false
        }));
        return { unmount: function () { root.unmount(); } };
      }
    };

    // ── Semplice auto-intercept ──────────────────────────────────────────
    /**
     * Автоматически перехватывает клики по картинкам в Semplice-проектах.
     * Ищет стандартные паттерны Semplice: .semplice-item, .work-item,
     * data-lightbox, data-src и <a href="*.jpg">.
     *
     * Чтобы отключить — добавь data-gallery="off" на контейнер.
     * Чтобы явно включить на кастомный контейнер — добавь data-gallery="on".
     */
    function interceptSemplice() {
      // Селекторы, которые Semplice использует для медиа
      var MEDIA_SELECTORS = [
        // Ссылки на изображения / видео (стандартный Semplice lightbox)
        'a[data-lightbox]',
        'a[href$=".jpg"]:not([data-gallery="off"])',
        'a[href$=".jpeg"]:not([data-gallery="off"])',
        'a[href$=".png"]:not([data-gallery="off"])',
        'a[href$=".webp"]:not([data-gallery="off"])',
        'a[href$=".gif"]:not([data-gallery="off"])',
        'a[href$=".mp4"]:not([data-gallery="off"])',
        'a[href$=".webm"]:not([data-gallery="off"])',
        // Semplice project items
        '.semplice-item .work-item__image-wrap > a',
        '.ss-item a.ss-item-link',
        // Явная метка
        '[data-gallery="on"] img',
        '[data-gallery="on"] a'
      ];

      var VIDEO_EXT = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;
      var IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i;

      function getMediaType(url) {
        if (VIDEO_EXT.test(url)) return 'video';
        if (IMAGE_EXT.test(url)) return 'image';
        return 'image';
      }

      function buildItem(el, index) {
        var href = el.getAttribute('href') || el.getAttribute('data-src') || el.getAttribute('data-lightbox-src');
        var img = el.querySelector('img');
        var src = href || (img && (img.getAttribute('data-src') || img.src)) || '';
        if (!src) return null;
        var thumb = (img && (img.getAttribute('data-src') || img.src)) || src;
        var alt = (img && img.alt) || el.getAttribute('aria-label') || '';
        var type = getMediaType(src);
        return { id: 'mg-item-' + index, type: type, src: src, thumbnailSrc: thumb, alt: alt,
          poster: type === 'video' ? thumb : undefined };
      }

      function collectAndOpen(group, clickedEl) {
        var items = [];
        var startIndex = 0;
        group.forEach(function (el, i) {
          var item = buildItem(el, i);
          if (!item) return;
          if (el === clickedEl) startIndex = items.length;
          items.push(item);
        });
        if (items.length) window.MediaGallery.open(items, startIndex);
      }

      // Один обработчик на document (event delegation)
      document.addEventListener('click', function (e) {
        // Найти ближайший элемент, подходящий под наши селекторы
        var target = e.target;
        var matched = null;

        for (var s = 0; s < MEDIA_SELECTORS.length; s++) {
          var sel = MEDIA_SELECTORS[s];
          var candidate = target.closest(sel);
          if (candidate) { matched = candidate; break; }
        }

        if (!matched) return;

        // Проверяем, не отключена ли галерея явно
        if (matched.closest('[data-gallery="off"]')) return;

        // Находим все соседние медиа-элементы в одной группе
        // (ищем общего родителя: .semplice-gallery, .ss-grid, section и т.д.)
        var GROUP_SELECTORS = [
          '.semplice-gallery', '.ss-grid', '.work-grid',
          '[data-gallery-group]', '.gallery', 'section', '.module'
        ];

        var container = null;
        for (var gs = 0; gs < GROUP_SELECTORS.length; gs++) {
          var c = matched.closest(GROUP_SELECTORS[gs]);
          if (c && c !== matched) { container = c; break; }
        }

        var group = [];
        if (container) {
          MEDIA_SELECTORS.forEach(function (sel) {
            try {
              container.querySelectorAll(sel).forEach(function (el) {
                if (group.indexOf(el) === -1) group.push(el);
              });
            } catch (err) {}
          });
        }
        if (!group.length || group.indexOf(matched) === -1) {
          group = [matched];
        }

        // Блокируем Semplice-лайтбокс
        e.preventDefault();
        e.stopPropagation();

        // Открываем нашу галерею
        mountGlobalController();
        collectAndOpen(group, matched);
      }, true /* capture — перехватываем раньше Semplice */);
    }

    // ── interceptAllImages — клик по img.mg-include → fullscreen ────────
    /**
     * Реагирует ТОЛЬКО на клики по картинкам с классом mg-include.
     * Открывает галерею со ВСЕМИ img.mg-include на странице.
     *
     * Как добавить класс в Semplice:
     *   Настройки изображения → поле «CSS Class» → введи: mg-include
     */
    function interceptAllImages() {
      function imgToItem(img, idx) {
        var src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
                  img.getAttribute('data-original') || img.src || '';
        if (!src || src.startsWith('data:')) return null;
        return { id: 'mg-inc-' + idx, type: 'image', src: src, thumbnailSrc: src, alt: img.alt || '' };
      }

      document.addEventListener('click', function (e) {
        var img = e.target;
        if (!img || img.tagName !== 'IMG') return;
        // Реагируем ТОЛЬКО на mg-include
        if (!img.classList.contains('mg-include')) return;
        // Не трогаем наш собственный UI
        if (img.closest('.media-gallery') || img.closest('#media-gallery-overlay-root')) return;

        // Собираем ВСЕ img.mg-include на странице
        var allImgs = Array.from(document.querySelectorAll('img.mg-include')).filter(function (i) {
          return !i.closest('.media-gallery') && !i.closest('#media-gallery-overlay-root');
        });

        var items = [];
        var startIndex = 0;
        allImgs.forEach(function (i, idx) {
          var item = imgToItem(i, idx);
          if (!item) return;
          if (i === img) startIndex = items.length;
          items.push(item);
        });

        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        window.MediaGallery.open(items, startIndex);
      }, true);
    }

    // ── replaceSliders — встроенный Semplice-слайдер → наша галерея ──────
    /**
     * Находит Semplice-слайдеры (Splide.js и кастомные),
     * извлекает картинки и монтирует нашу inline-галерею на их место.
     * Галерея наследует размер контейнера оригинального слайдера.
     *
     * Чтобы исключить конкретный слайдер: добавь data-gallery="off" на него.
     * Чтобы принудительно включить нестандартный элемент: data-gallery="slider".
     */
    function replaceSliders() {
      // Селекторы Semplice/Splide слайдеров
      var SLIDER_SELECTORS = [
        '.splide',
        '[data-splide]',
        '.semplice-slider',
        '.semplice-slideshow',
        '.semplice-module-slider',
        '.module-type-slider',
        '.ss-slider',
        '.ss-slideshow',
        '[class*="module"][class*="slider"]',
        '[class*="slideshow"]',
        '[class*="carousel"]',
        '.media-module',
        '.semplice-media',
        '[data-gallery="slider"]'  // явная метка
      ];

      // Где внутри слайдера искать картинки
      var SLIDE_IMG_SELECTORS = [
        '.splide__slide img',
        '.splide__slide a',
        'li img',
        'li a',
        '.slide img',
        '.slide a',
        'img'  // fallback
      ];

      var VIDEO_EXT = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;

      function extractItemsFromSlider(sliderEl) {
        var found = [];

        // Пробуем каждый селектор по очереди, берём первый давший результат
        for (var si = 0; si < SLIDE_IMG_SELECTORS.length; si++) {
          var els = Array.from(sliderEl.querySelectorAll(SLIDE_IMG_SELECTORS[si]));
          if (!els.length) continue;

          els.forEach(function (el, idx) {
            var src, thumb, alt, type;

            if (el.tagName === 'IMG') {
              src = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') ||
                    el.getAttribute('data-original') || el.src || '';
              thumb = src;
              alt = el.alt || '';
              type = 'image';
            } else if (el.tagName === 'A') {
              var href = el.getAttribute('href') || '';
              var childImg = el.querySelector('img');
              src = href || (childImg && (childImg.getAttribute('data-src') || childImg.src)) || '';
              thumb = (childImg && (childImg.getAttribute('data-src') || childImg.src)) || src;
              alt = (childImg && childImg.alt) || el.getAttribute('aria-label') || '';
              type = VIDEO_EXT.test(src) ? 'video' : 'image';
            }

            if (!src || src.startsWith('data:')) return;
            found.push({
              id: 'slider-item-' + idx + '-' + src.slice(-10),
              type: type,
              src: src,
              thumbnailSrc: thumb || src,
              alt: alt || '',
              poster: type === 'video' ? (thumb || undefined) : undefined
            });
          });

          if (found.length) break; // нашли через этот селектор — хватит
        }

        return found;
      }

      function mountGalleryInSlider(sliderEl) {
        if (sliderEl.dataset.mgMounted) return; // уже заменён
        if (sliderEl.closest('[data-gallery="off"]')) return;

        var items = extractItemsFromSlider(sliderEl);
        if (!items.length) return;

        // Сохраняем оригинальную высоту контейнера чтобы не прыгал лейаут
        var origHeight = sliderEl.offsetHeight;

        // Создаём точку монтирования
        var mountEl = document.createElement('div');
        mountEl.className = 'mg-slider-replacement';
        if (origHeight > 0) mountEl.style.minHeight = origHeight + 'px';

        // Очищаем слайдер и монтируем
        sliderEl.innerHTML = '';
        sliderEl.appendChild(mountEl);
        sliderEl.dataset.mgMounted = 'true';
        // Убираем классы Splide чтобы не конфликтовали его стили
        sliderEl.classList.remove('splide', 'is-initialized', 'is-rendered');

        window.MediaGallery.mount(mountEl, items, { previewMode: 'thumbnails' });
      }

      function findAndReplaceAll() {
        SLIDER_SELECTORS.forEach(function (sel) {
          try {
            document.querySelectorAll(sel).forEach(function (el) {
              mountGalleryInSlider(el);
            });
          } catch (err) { /* невалидный селектор — пропускаем */ }
        });
      }

      // Запускаем сразу и ещё раз через 800ms (на случай если Semplice
      // инициализирует слайдер асинхронно)
      findAndReplaceAll();
      setTimeout(findAndReplaceAll, 800);
      setTimeout(findAndReplaceAll, 2000);

      // MutationObserver для динамически добавляемых слайдеров (SPA-режим)
      if (window.MutationObserver) {
        var observer = new MutationObserver(function (mutations) {
          var shouldCheck = mutations.some(function (m) { return m.addedNodes.length; });
          if (shouldCheck) findAndReplaceAll();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    // ── mountManualSliders — ручной монтаж через data-mg-slider ─────────
    /**
     * Ищет элементы с атрибутом [data-mg-slider] и монтирует в них
     * нашу inline-галерею. Картинки берёт из дочерних <img> элементов.
     *
     * Использование в Semplice (блок Custom HTML):
     *   <div data-mg-slider>
     *     <img src="url1.jpg" alt="Фото 1" />
     *     <img src="url2.jpg" alt="Фото 2" />
     *   </div>
     *
     * Или через атрибут data-mg-srcs (URL через пробел или запятую):
     *   <div data-mg-slider data-mg-srcs="url1.jpg,url2.jpg,url3.jpg"></div>
     */
    function mountManualSliders() {
      function processEl(el) {
        if (el.dataset.mgMounted) return;
        var items = [];

        // Вариант 1: URL через data-mg-srcs
        var srcsAttr = el.getAttribute('data-mg-srcs') || '';
        if (srcsAttr) {
          srcsAttr.split(/[\s,]+/).filter(Boolean).forEach(function(src, idx) {
            items.push({ id: 'mg-manual-' + idx, type: /\.(mp4|webm)$/i.test(src) ? 'video' : 'image',
              src: src, thumbnailSrc: src, alt: '' });
          });
        }

        // Вариант 2: дочерние <img> (поддержка data-desktop-src / data-mobile-src)
        var isDesktop = window.innerWidth >= 950;
        if (!items.length) {
          Array.from(el.querySelectorAll('img')).forEach(function(img, idx) {
            var src = (isDesktop && img.getAttribute('data-desktop-src'))
                   || (!isDesktop && img.getAttribute('data-mobile-src'))
                   || img.getAttribute('data-src') || img.src || '';
            if (!src || src.startsWith('data:')) return;
            var thumb = img.getAttribute('data-mobile-src') || src;
            items.push({ id: 'mg-manual-' + idx, type: /\.(mp4|webm)$/i.test(src) ? 'video' : 'image',
              src: src, thumbnailSrc: thumb, alt: img.alt || '' });
          });
        }

        if (!items.length) return;
        el.dataset.mgMounted = 'true';
        el.innerHTML = '';
        window.MediaGallery.mount(el, items, { previewMode: 'thumbnails', naturalSize: true });
      }

      document.querySelectorAll('[data-mg-slider]').forEach(processEl);
      setTimeout(function() { document.querySelectorAll('[data-mg-slider]').forEach(processEl); }, 800);

      if (window.MutationObserver) {
        new MutationObserver(function(mutations) {
          if (mutations.some(function(m) { return m.addedNodes.length; }))
            document.querySelectorAll('[data-mg-slider]').forEach(processEl);
        }).observe(document.body, { childList: true, subtree: true });
      }
    }

    // ─── Запуск всего ────────────────────────────────────────────────────
    mountGlobalController();

    function startAll() {
      interceptSemplice();    // перехват a[data-lightbox], ссылок на jpg/mp4
      interceptAllImages();   // перехват кликов по ЛЮБОМУ <img>
      replaceSliders();       // замена Semplice-слайдеров нашей галереей
      mountManualSliders();   // ручной монтаж через [data-mg-slider]
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startAll);
    } else {
      startAll();
    }

    console.log('[MediaGallery] Loaded. API: window.MediaGallery.open(items, index)');
  }
})();
