import { MotionConfig } from 'motion/react';
import BlurText from './BlurText';
import SpotlightCard from './SpotlightCard';

/**
 * Tampilan awal chat Hermes. Tombol memakai data-suggest; klik ditangani hermes-ui.ts
 * lewat delegasi, jadi tetap bekerja sebelum island ter-hydrate.
 */
export default function HermesEmpty({ suggestions }: { suggestions: string[] }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="hm-empty-content mx-auto flex max-w-lg flex-col items-center pt-2 text-center sm:pt-8">
        <span className="hm-empty-icon mb-3 inline-flex size-12 items-center justify-center rounded-full bg-slate-900 text-white">
          <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </span>
        <BlurText text="Perintahkan Hermes" delay={80} animateBy="words" direction="top" className="hm-empty-title justify-center text-[15px] font-semibold text-slate-900" />
        <p className="hm-empty-description mt-1 text-[13px] leading-relaxed text-slate-500">Hermes berjalan di server ini dan memakai tool-nya sendiri untuk mengerjakan permintaanmu.</p>
        <details className="hm-mobile-suggestions sm:hidden">
          <summary>Contoh permintaan</summary>
          {suggestions.map((s) => <button key={s} type="button" data-suggest={s}>{s}</button>)}
        </details>
        <div className="mt-5 hidden w-full space-y-2 sm:block">
          {suggestions.map((s) => (
            <SpotlightCard key={s} theme="light" spotlightColor="#268E6B" intensity={0.5} spotlightSize={220} borderGlow={0.8} className="!rounded-xl !p-0 !shadow-none">
              <button type="button" data-suggest={s} className="relative z-[2] w-full px-3.5 py-2.5 text-left text-[13px] text-slate-700 transition-colors hover:text-slate-900">
                {s}
              </button>
            </SpotlightCard>
          ))}
        </div>
      </div>
    </MotionConfig>
  );
}
