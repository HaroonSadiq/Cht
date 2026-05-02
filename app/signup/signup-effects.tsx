'use client';

// Replays the signup.html inline script: 5-step onboarding flow,
// /api/auth/signup POST, prefs persistence to localStorage, optional
// /api/auth/survey POST (where-did-you-hear / role / business type),
// redirect to /dashboard. Mounted once on the signup page.

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
      survey: {
        heardFrom: null as string | null,
        role:      null as string | null,
      },
    };

    const card = document.getElementById('card');
    const segs = [1, 2, 3, 4, 5].map((i) => document.getElementById(`seg${i}`));
    const phaseEls = card?.querySelectorAll<HTMLElement>('.phase') ?? [];

    function showPhase(n: number) {
      state.phase = n;
      phaseEls.forEach((el) => el.classList.toggle('active', Number(el.dataset.phase) === n));
      // Progress bar covers steps 1–5; phase 6 is the success animation
      // and shows all five segs as "done".
      segs.forEach((s, i) => {
        s?.classList.toggle('on', i + 1 === n);
        s?.classList.toggle('done', i + 1 < n || n >= 6);
      });
    }

    // ── Option chips ───────────────────────────────────
    type ChoiceTarget =
      | { kind: 'prefs'; key: 'platforms' | 'useCase' | 'volume' }
      | { kind: 'survey'; key: 'heardFrom' | 'role' };
    function bindOptions(groupId: string, target: ChoiceTarget, multi: boolean, onPick?: (value: string) => void) {
      const group = document.getElementById(groupId);
      if (!group) return () => {};
      const handler = (e: Event) => {
        const t = e.target as HTMLElement;
        const opt = t.closest<HTMLElement>('.opt');
        if (!opt) return;
        const value = opt.dataset.value!;
        if (multi) {
          // Only `platforms` is multi-select today, so the array lookup is safe.
          const arr = state.prefs.platforms;
          const i = arr.indexOf(value);
          if (i >= 0) { arr.splice(i, 1); opt.classList.remove('sel'); }
          else        { arr.push(value);    opt.classList.add('sel'); }
        } else {
          const bag = (target.kind === 'prefs' ? state.prefs : state.survey) as Record<string, unknown>;
          bag[target.key] = value;
          group.querySelectorAll('.opt').forEach((o) => o.classList.toggle('sel', o === opt));
          onPick?.(value);
        }
      };
      group.addEventListener('click', handler);
      return () => group.removeEventListener('click', handler);
    }

    const heardFromOtherWrap = document.getElementById('heardFromOtherWrap');
    const unbinders = [
      bindOptions('optPlatforms',  { kind: 'prefs',  key: 'platforms' }, true),
      bindOptions('optUseCase',    { kind: 'prefs',  key: 'useCase'   }, false),
      bindOptions('optVolume',     { kind: 'prefs',  key: 'volume'    }, false),
      bindOptions('optHeardFrom',  { kind: 'survey', key: 'heardFrom' }, false, (v) => {
        if (heardFromOtherWrap) heardFromOtherWrap.style.display = v === 'other' ? 'block' : 'none';
      }),
      bindOptions('optRole',       { kind: 'survey', key: 'role'      }, false),
    ];

    // ── Back / Next nav ────────────────────────────────
    function flashError(msg: string) { alert(msg); }
    const navHandler = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-back]')) {
        if (state.phase > 1) showPhase(state.phase - 1);
      }
      if (t.closest('[data-next]')) {
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

    const submitHandler = async (e: Event) => {
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
    form?.addEventListener('submit', submitHandler);

    // ── Persist prefs to localStorage ──────────────────
    function persistPrefs() {
      const payload = {
        platforms: state.prefs.platforms,
        useCase:   state.prefs.useCase,
        volume:    state.prefs.volume,
        onboardedAt: new Date().toISOString(),
      };
      try { localStorage.setItem('flowbot_prefs', JSON.stringify(payload)); } catch (_) {}
    }

    // ── Phase 4 finish: advance to survey ──────────────
    const finishBtn = document.getElementById('finishBtn');
    const finishHandler = () => {
      if (!state.prefs.volume) return flashError('Pick a volume range.');
      persistPrefs();
      showPhase(5);
    };
    finishBtn?.addEventListener('click', finishHandler);

    // ── Phase 5 (survey) submit / skip ─────────────────
    const surveyErr = document.getElementById('surveyErr');
    function showSurveyErr(msg: string) {
      if (!surveyErr) return;
      surveyErr.textContent = msg;
      surveyErr.classList.add('show');
    }
    function goToSuccessAndRedirect() {
      showPhase(6);
      setTimeout(() => { window.location.href = '/dashboard'; }, 1100);
    }

    const surveySubmitBtn = document.getElementById('surveySubmitBtn') as HTMLButtonElement | null;
    const surveySubmitHandler = async () => {
      surveyErr?.classList.remove('show');
      if (!state.survey.heardFrom) return showSurveyErr('Pick where you heard about us, or click Skip.');

      const heardFromOther = state.survey.heardFrom === 'other'
        ? (document.getElementById('heardFromOther') as HTMLInputElement | null)?.value.trim() || null
        : null;
      const businessType = (document.getElementById('businessType') as HTMLInputElement | null)?.value.trim() || null;

      const body = {
        heardFrom:      state.survey.heardFrom,
        heardFromOther,
        role:           state.survey.role,
        businessType,
        platforms:      state.prefs.platforms,
        useCase:        state.prefs.useCase,
        volume:         state.prefs.volume,
      };

      if (surveySubmitBtn) {
        surveySubmitBtn.disabled = true;
        surveySubmitBtn.innerHTML = '<span class="spinner"></span>&nbsp;Sending…';
      }
      try {
        // We don't block the redirect on this — but we DO wait briefly so
        // the user sees feedback. Network failure isn't fatal: signup
        // already succeeded; the survey is purely informational.
        await fetch('/api/auth/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        }).catch(() => {});
      } finally {
        goToSuccessAndRedirect();
      }
    };
    surveySubmitBtn?.addEventListener('click', surveySubmitHandler);

    const surveySkipBtn = document.getElementById('surveySkipBtn');
    const surveySkipHandler = () => goToSuccessAndRedirect();
    surveySkipBtn?.addEventListener('click', surveySkipHandler);

    // ── Cleanup ────────────────────────────────────────
    return () => {
      closeBtn?.removeEventListener('click', cancelSignup);
      document.removeEventListener('keydown', onKey);
      unbinders.forEach((fn) => fn?.());
      card?.removeEventListener('click', navHandler);
      form?.removeEventListener('submit', submitHandler);
      finishBtn?.removeEventListener('click', finishHandler);
      surveySubmitBtn?.removeEventListener('click', surveySubmitHandler);
      surveySkipBtn?.removeEventListener('click', surveySkipHandler);
    };
  }, []);

  return null;
}
