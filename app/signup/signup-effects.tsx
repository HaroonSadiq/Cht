'use client';

// Replays the signup.html inline script: 4-step onboarding flow,
// /api/auth/signup POST, prefs persistence to localStorage, redirect
// to /dashboard. Mounted once on the signup page.

import { useEffect } from 'react';

export default function SignupEffects() {
  useEffect(() => {
    // ── Close + Escape ──────────────────────────────────
    const cancelSignup = () => { window.location.href = '/'; };
    const closeBtn = document.getElementById('signupClose');
    closeBtn?.addEventListener('click', cancelSignup);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelSignup(); };
    document.addEventListener('keydown', onKey);

    // ── State ──────────────────────────────────────────
    const state = {
      phase: 1,
      user: null as null | { name?: string; email: string },
      prefs: {
        platforms: [] as string[],
        useCase:   null as string | null,
        volume:    null as string | null,
      },
    };

    const card = document.getElementById('card');
    const segs = [1, 2, 3, 4].map((i) => document.getElementById(`seg${i}`));
    const phaseEls = card?.querySelectorAll<HTMLElement>('.phase') ?? [];

    function showPhase(n: number) {
      state.phase = n;
      phaseEls.forEach((el) => el.classList.toggle('active', Number(el.dataset.phase) === n));
      segs.forEach((s, i) => {
        s?.classList.toggle('on', i + 1 === n);
        s?.classList.toggle('done', i + 1 < n);
      });
    }

    // ── Option chips ───────────────────────────────────
    type PrefsKey = 'platforms' | 'useCase' | 'volume';
    function bindOptions(groupId: string, key: PrefsKey, multi: boolean) {
      const group = document.getElementById(groupId);
      if (!group) return () => {};
      const handler = (e: Event) => {
        const target = e.target as HTMLElement;
        const opt = target.closest<HTMLElement>('.opt');
        if (!opt) return;
        const value = opt.dataset.value!;
        if (multi) {
          const arr = state.prefs[key] as string[];
          const i = arr.indexOf(value);
          if (i >= 0) { arr.splice(i, 1); opt.classList.remove('sel'); }
          else        { arr.push(value);    opt.classList.add('sel'); }
        } else {
          (state.prefs as Record<string, unknown>)[key] = value;
          group.querySelectorAll('.opt').forEach((o) => o.classList.toggle('sel', o === opt));
        }
      };
      group.addEventListener('click', handler);
      return () => group.removeEventListener('click', handler);
    }
    const unbinders = [
      bindOptions('optPlatforms', 'platforms', true),
      bindOptions('optUseCase',   'useCase',   false),
      bindOptions('optVolume',    'volume',    false),
    ];

    // ── Back / Next nav ────────────────────────────────
    function flashError(msg: string) { alert(msg); }
    const navHandler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-back]')) {
        if (state.phase > 1) showPhase(state.phase - 1);
      }
      if (target.closest('[data-next]')) {
        if (state.phase === 2 && state.prefs.platforms.length === 0) {
          return flashError('Pick at least one platform.');
        }
        if (state.phase === 3 && !state.prefs.useCase) {
          return flashError('Pick a primary use case.');
        }
        showPhase(state.phase + 1);
      }
    };
    card?.addEventListener('click', navHandler);

    // ── Signup submit ──────────────────────────────────
    const form     = document.getElementById('signupForm') as HTMLFormElement | null;
    const signupBtn = document.getElementById('signupBtn') as HTMLButtonElement | null;
    const signupErr = document.getElementById('signupErr');

    function showSignupErr(msg: string) {
      if (!signupErr) return;
      signupErr.textContent = msg;
      signupErr.classList.add('show');
    }

    const submitHandler = async (e: SubmitEvent) => {
      e.preventDefault();
      if (!form) return;
      const fd = new FormData(form);
      const body = {
        name:     String(fd.get('name')     || '').trim(),
        email:    String(fd.get('email')    || '').trim().toLowerCase(),
        password: String(fd.get('password') || ''),
      };
      signupErr?.classList.remove('show');

      if (body.password.length < 8) return showSignupErr('Password must be at least 8 characters.');

      if (signupBtn) {
        signupBtn.disabled = true;
        signupBtn.innerHTML = '<span class="spinner"></span>&nbsp;Creating account…';
      }
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({} as { user?: typeof state.user; error?: string }));
        if (!res.ok) {
          const msg =
            res.status === 409 ? 'That email is already registered. Try signing in instead.'
            : (typeof data?.error === 'string' ? data.error : 'Signup failed. Please try again.');
          throw new Error(msg);
        }
        state.user = data.user ?? null;
        showPhase(2);
      } catch (err: any) {
        showSignupErr(err?.message || 'Signup failed.');
      } finally {
        if (signupBtn) {
          signupBtn.disabled = false;
          signupBtn.innerHTML = 'Create account →';
        }
      }
    };
    form?.addEventListener('submit', submitHandler as EventListener);

    // ── Finish: persist prefs + redirect ───────────────
    const finishBtn = document.getElementById('finishBtn');
    const finishHandler = () => {
      if (!state.prefs.volume) return flashError('Pick a volume range.');
      const payload = {
        platforms: state.prefs.platforms,
        useCase:   state.prefs.useCase,
        volume:    state.prefs.volume,
        onboardedAt: new Date().toISOString(),
      };
      try { localStorage.setItem('flowbot_prefs', JSON.stringify(payload)); } catch (_) {}
      showPhase(5);
      setTimeout(() => { window.location.href = '/dashboard'; }, 1100);
    };
    finishBtn?.addEventListener('click', finishHandler);

    // ── Cleanup ────────────────────────────────────────
    return () => {
      closeBtn?.removeEventListener('click', cancelSignup);
      document.removeEventListener('keydown', onKey);
      unbinders.forEach((fn) => fn?.());
      card?.removeEventListener('click', navHandler);
      form?.removeEventListener('submit', submitHandler as EventListener);
      finishBtn?.removeEventListener('click', finishHandler);
    };
  }, []);

  return null;
}
