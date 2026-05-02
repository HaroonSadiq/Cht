'use client';

// Replays the inline-script behavior from the legacy index.html:
// reveal-on-scroll, scroll-progress hairline, mobile nav toggle, the
// elapsed-time counter, and the magnetic button micro-interaction.
// Mounted once on the landing page.

import { useEffect } from 'react';

export default function LandingEffects() {
  useEffect(() => {
    // ── Reveal on scroll ─────────────────────────────────
    const reveals = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    reveals.forEach((el) => io.observe(el));

    // Stagger reveals inside grids
    document.querySelectorAll('.steps, .ch-grid').forEach((grid) => {
      grid.querySelectorAll<HTMLElement>('.reveal').forEach((el, i) => {
        el.style.transitionDelay = `${i * 0.09}s`;
      });
    });

    // ── Nav scroll state + scroll progress ──────────────
    const nav = document.getElementById('nav');
    const progress = document.getElementById('scrollProgress');
    const onScroll = () => {
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 30);
      if (progress) {
        const docH = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docH > 0 ? (window.scrollY / docH) * 100 : 0;
        progress.style.width = pct + '%';
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // ── Close mobile nav on link click ───────────────────
    const linkHandler = () => nav?.classList.remove('open');
    const links = document.querySelectorAll('.nav-links a');
    links.forEach((a) => a.addEventListener('click', linkHandler));

    // ── Live elapsed timer (T+HH:MM:SS) ──────────────────
    const timer = document.getElementById('liveTimer');
    let timerHandle: number | undefined;
    if (timer) {
      const t0 = Date.now();
      const tick = () => {
        const s = Math.floor((Date.now() - t0) / 1000);
        const hh = String(Math.floor(s / 3600)).padStart(2, '0');
        const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        timer.textContent = `T+${hh}:${mm}:${ss}`;
      };
      tick();
      timerHandle = window.setInterval(tick, 1000);
    }

    // ── Magnetic buttons ────────────────────────────────
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const magneticHandlers: Array<{ el: HTMLElement; move: (e: MouseEvent) => void; leave: () => void }> = [];
    if (!reduced && matchMedia('(pointer: fine)').matches) {
      document.querySelectorAll<HTMLElement>('.btn-magnetic').forEach((btn) => {
        const move = (e: MouseEvent) => {
          const r = btn.getBoundingClientRect();
          const x = e.clientX - (r.left + r.width / 2);
          const y = e.clientY - (r.top + r.height / 2);
          btn.style.transform = `translate(${x * 0.18}px, ${y * 0.22}px)`;
        };
        const leave = () => {
          btn.style.transform = '';
        };
        btn.addEventListener('mousemove', move);
        btn.addEventListener('mouseleave', leave);
        magneticHandlers.push({ el: btn, move, leave });
      });
    }

    // ── Cleanup on unmount ──────────────────────────────
    return () => {
      window.removeEventListener('scroll', onScroll);
      links.forEach((a) => a.removeEventListener('click', linkHandler));
      if (timerHandle !== undefined) clearInterval(timerHandle);
      magneticHandlers.forEach(({ el, move, leave }) => {
        el.removeEventListener('mousemove', move);
        el.removeEventListener('mouseleave', leave);
      });
    };
  }, []);

  return null;
}
