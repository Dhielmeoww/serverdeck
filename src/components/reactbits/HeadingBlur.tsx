import { MotionConfig } from 'motion/react';
import BlurText from './BlurText';

/** Judul yang muncul kata per kata. MotionConfig mematuhi setelan kurangi animasi. */
export default function HeadingBlur({ text, className = '' }: { text: string; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <BlurText text={text} delay={90} animateBy="words" direction="top" className={`justify-center ${className}`} />
    </MotionConfig>
  );
}
