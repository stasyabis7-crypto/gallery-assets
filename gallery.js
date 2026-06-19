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
          className = props.className || '';

      var thumbsRef = useRef(null);
      var thumbRefs = useRef([]);
      var swipeRef = useRef(null);
      var suppressClickRef = useRef(false);
      var loadedRef = useRef({});
      var [dragOffset, setDragOffset] = useState(0);
      var [closeDragOffset, setCloseDragOffset] = useState(0);
      var [loadedImages, setLoadedImages] = useState({});
      var isFullscreen = className.indexOf('media-gallery_fullscreen') !== -1;

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

      function handlePointerDown(e) {
        if ((!hasSeveralItems && !isFullscreen) || e.pointerType === 'mouse') return;
        swipeRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, currentX: e.clientX };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      function handlePointerMove(e) {
        var swipe = swipeRef.current;
        if (!swipe || swipe.pointerId !== e.pointerId) return;
        var dx = e.clientX - swipe.startX, dy = e.clientY - swipe.startY;
        swipe.currentX = e.clientX;
        if (!swipe.lockedAxis && (Math.abs(dx) > 8 || Math.abs(dy) > 8))
          swipe.lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        if (swipe.lockedAxis === 'vertical' && isFullscreen && onClose && isMobile()) {
          if (dy > 0) { suppressClickRef.current = true; setCloseDragOffset(dy); }
          return;
        }
        if (swipe.lockedAxis !== 'horizontal' || !hasSeveralItems) return;
        var isFirst = activeIndex === 0, isLast = activeIndex === items.length - 1;
        var resisted = (isFirst && dx > 0) || (isLast && dx < 0) ? dx * 0.32 : dx;
        suppressClickRef.current = true;
        setDragOffset(resisted);
      }
      function finishSwipe(e) {
        var swipe = swipeRef.current;
        if (!swipe || swipe.pointerId !== e.pointerId) return;
        var dx = swipe.currentX - swipe.startX, dy = e.clientY - swipe.startY;
        if (swipe.lockedAxis === 'horizontal' && Math.abs(dx) > 54) {
          if (dx < 0 && activeIndex < items.length - 1) next();
          if (dx > 0 && activeIndex > 0) previous();
        }
        if (swipe.lockedAxis === 'vertical' && isFullscreen && onClose && isMobile() && dy > 96) onClose();
        if (Math.abs(dx) > 8) {
          suppressClickRef.current = true;
          setTimeout(function () { suppressClickRef.current = false; }, 0);
        }
        setDragOffset(0); setCloseDragOffset(0); swipeRef.current = null;
      }
      function handleViewportClick() {
        if (suppressClickRef.current) return;
        if (onViewportClick) onViewportClick();
      }

      var thumbsProps = { items: items, activeIndex: activeIndex, setActiveIndex: setActiveIndex,
        thumbsRef: thumbsRef, thumbRefs: thumbRefs, placement: thumbnailsPlacement };

      return h('div', {
        className: 'media-gallery' + (isPopup ? ' media-gallery_popup' : '') + (closeDragOffset ? ' media-gallery_close_dragging' : '') + (className ? ' ' + className : ''),
        style: closeDragOffset ? { opacity: Math.max(0.52, 1 - closeDragOffset / 360), transform: 'translateY(' + closeDragOffset + 'px) scale(' + Math.max(0.92, 1 - closeDragOffset / 2200) + ')' } : undefined,
        'aria-label': ariaLabel, role: 'region', tabIndex: 0, onKeyDown: onKeyDown
      },
        onClose && h('button', { className: 'media-gallery__close', type: 'button', 'aria-label': 'Закрыть', onClick: onClose }, h(IconX)),
        h('div', { className: 'media-gallery__layout' + (showThumbnails && thumbnailsPlacement === 'side' ? ' media-gallery__layout_with_side_thumbs' : '') },
          showThumbnails && thumbnailsPlacement === 'side' && h(Thumbnails, thumbsProps),
          h('div', { className: 'media-gallery__frame' },
            h('div', {
              className: 'media-gallery__viewport',
              role: onViewportClick ? 'button' : undefined,
              'aria-label': onViewportClick ? 'Открыть полноэкранно' : undefined,
              tabIndex: onViewportClick ? 0 : -1,
              onClick: handleViewportClick,
              onPointerDown: handlePointerDown, onPointerMove: handlePointerMove,
              onPointerUp: finishSwipe, onPointerCancel: finishSwipe,
              onKeyDown: function (e) {
                if (!onViewportClick) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewportClick(); }
              }
            },
              h('div', {
                className: 'media-gallery__track' + (dragOffset ? ' media-gallery__track_dragging' : ''),
                style: { transform: 'translateX(calc(' + (-activeIndex * 100) + '% + ' + dragOffset + 'px))' }
              }, items.map(function (item, idx) {
                return h('div', {
                  className: 'media-gallery__slide' + (item.type === 'image' && !loadedImages[item.id] ? ' media-gallery__slide_loading' : ''),
                  key: item.id, 'aria-hidden': idx !== activeIndex
                },
                  item.type === 'image' ? [
                    h('div', { key: 'bd', className: 'media-gallery__image-backdrop', 'aria-hidden': 'true', style: { backgroundImage: 'url(' + item.src + ')' } }),
                    h('img', { key: 'img', className: 'media-gallery__image', src: item.src, alt: item.alt || '',
                      onLoad: function () { setLoadedImages(function (cur) { var n = Object.assign({}, cur); n[item.id] = true; return n; }); } }),
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
          videoRefs: videoRefs, isPopup: false,
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
          ariaLabel: opts.ariaLabel || 'Галерея'
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

    // ── interceptAllImages — клик по ЛЮБОЙ картинке → fullscreen ────────
    /**
     * Перехватывает клики по любому <img> на странице.
     * Собирает все изображения из ближайшего смыслового контейнера
     * (секция, статья, .module и т.д.) и открывает галерею.
     *
     * Исключения (не перехватываются):
     *   — маленькие картинки < 80px (иконки, логотипы)
     *   — img внутри <nav>, <header> без явного [data-gallery]
     *   — img внутри .media-gallery (наш же UI)
     *   — контейнеры с [data-gallery="off"]
     */
    function interceptAllImages() {
      // Контейнеры, которые считаются «группой» для сбора соседних фото
      var GROUP_PARENTS = [
        '.semplice-module', '.module', '.semplice-item', '.work-item',
        'section', 'article', '.gallery', '.semplice-gallery',
        '.splide__list', '.slider-wrapper', '[class*="grid"]', '[class*="Grid"]'
      ];

      // Элементы, внутри которых НЕ перехватываем (если нет явного data-gallery="on")
      var SKIP_INSIDE = ['nav', 'header', 'footer', '.site-logo', '.mg-fullscreen', '.mg-overlay'];

      function isSmallIcon(img) {
        // Пропускаем крошечные картинки (иконки, аватары меньше 80px)
        return (img.naturalWidth > 0 && img.naturalWidth < 80) ||
               (img.width > 0 && img.width < 80);
      }

      function imgToItem(img, idx) {
        var src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') ||
                  img.getAttribute('data-original') || img.src || '';
        // Убираем low-res placeholder (data:image/...)
        if (!src || src.startsWith('data:')) return null;
        return {
          id: 'all-img-' + idx + '-' + src.slice(-12),
          type: 'image',
          src: src,
          thumbnailSrc: src,
          alt: img.alt || ''
        };
      }

      document.addEventListener('click', function (e) {
        var img = e.target;
        // Только клик именно по <img>
        if (!img || img.tagName !== 'IMG') return;

        // Не трогаем нашу собственную галерею
        if (img.closest('.media-gallery') || img.closest('#media-gallery-overlay-root')) return;

        // Явное отключение
        if (img.closest('[data-gallery="off"]')) return;

        // Пропускаем nav/header/footer если нет явного включения
        var hasExplicitOn = !!img.closest('[data-gallery="on"]');
        if (!hasExplicitOn) {
          for (var si = 0; si < SKIP_INSIDE.length; si++) {
            if (img.closest(SKIP_INSIDE[si])) return;
          }
        }

        // Пропускаем иконки
        if (isSmallIcon(img)) return;

        // Если картинка внутри <a href="..."> ведущего НЕ на медиафайл —
        // скорее всего это навигационная ссылка, не трогаем
        var parentLink = img.closest('a[href]');
        if (parentLink && !hasExplicitOn) {
          var href = parentLink.getAttribute('href') || '';
          var isMediaLink = /\.(jpg|jpeg|png|gif|webp|avif|mp4|webm)(\?.*)?$/i.test(href) ||
                            parentLink.hasAttribute('data-lightbox');
          if (!isMediaLink) return; // обычная ссылка — не перехватываем
        }

        // Ищем ближайшую «группу» для сбора всех соседних фото
        var container = null;
        for (var gi = 0; gi < GROUP_PARENTS.length; gi++) {
          var c = img.closest(GROUP_PARENTS[gi]);
          if (c) { container = c; break; }
        }
        if (!container) container = img.parentElement || document.body;

        // Собираем все img внутри контейнера (исключая наш UI и иконки)
        var allImgs = Array.from(container.querySelectorAll('img')).filter(function (i) {
          return !i.closest('.media-gallery') &&
                 !i.closest('#media-gallery-overlay-root') &&
                 !isSmallIcon(i);
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
      }, true /* capture */);
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

    // ─── Запуск всего ────────────────────────────────────────────────────
    mountGlobalController();

    function startAll() {
      interceptSemplice();   // перехват a[data-lightbox], ссылок на jpg/mp4
      interceptAllImages();  // перехват кликов по ЛЮБОМУ <img>
      replaceSliders();      // замена Semplice-слайдеров нашей галереей
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startAll);
    } else {
      startAll();
    }

    console.log('[MediaGallery] Loaded. API: window.MediaGallery.open(items, index)');
  }
})();
