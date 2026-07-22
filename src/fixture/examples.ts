import type { SessionExport } from '../model/types';
import { fixture } from './fixture';
import { fireFixture } from '../gyakusan/fireFixture';
import { buildLearnFixture } from './builder';

// Thai example: how sound becomes an MP3 file, taught from first principles.
const thaiMp3 = buildLearnFixture(
  'example-th-mp3',
  'MP3 ทำงานยังไง (ตัวอย่าง)',
  2,
  [
    {
      md:
        '## เสียงคืออะไร\n\nเสียงคือ **คลื่นความดันอากาศ** ที่สั่นต่อเนื่อง เมื่อคุณปรบมือ ' +
        'อากาศถูกอัดแล้วคลายเป็นจังหวะ หูเราแปลความสั่นนั้นเป็นเสียง\n\n' +
        'ปัญหาคือคลื่นในธรรมชาติเป็นแบบ **ต่อเนื่อง (analog)** แต่คอมพิวเตอร์เก็บได้แค่ตัวเลข ' +
        'แล้วเราจะแปลงคลื่นต่อเนื่องเป็นตัวเลขได้ยังไง?',
    },
    {
      md:
        '## การสุ่มตัวอย่าง (Sampling)\n\nเราวัดความสูงของคลื่นเป็นช่วง ๆ ถี่มาก ๆ — ' +
        'คุณภาพซีดีวัด **44,100 ครั้งต่อวินาที** (44.1 kHz) แต่ละครั้งเก็บเป็นเลข 16 บิต\n\n' +
        'ยิ่งสุ่มถี่ ยิ่งได้เสียงใกล้ของจริง แต่ก็ยิ่งได้ตัวเลขเยอะ',
    },
    {
      md:
        '## ทำไมไฟล์ดิบถึงใหญ่\n\nเสียงสเตอริโอ 1 นาทีแบบดิบ (WAV) กินพื้นที่ราว **10 MB** ' +
        'เพลง 3 นาทีก็ ~30 MB เก็บเพลงเป็นพัน ๆ เพลงไม่ไหว\n\n' +
        'คำถามหลักคือ: จะทำให้ไฟล์เล็กลงมาก ๆ โดยหูคนแทบไม่รู้สึกต่างได้ยังไง?',
    },
    {
      md:
        '## การบีบอัดแบบ lossy กับ psychoacoustics\n\nMP3 ใช้ความรู้เรื่อง **การรับรู้เสียงของมนุษย์** ' +
        '(psychoacoustics): หูเรามี "จุดบอด" — เสียงเบาที่อยู่ใกล้เสียงดังจะถูกกลบจนไม่ได้ยิน\n\n' +
        'MP3 จึง **ทิ้งข้อมูลที่หูคนไม่ได้ยินอยู่แล้ว** ทำให้ไฟล์เล็กลง ~10 เท่า โดยเสียงยังดีอยู่',
    },
  ],
  [
    {
      chunkIndex: 1,
      anchor: '44,100 ครั้งต่อวินาที',
      question: 'ทำไมต้อง 44,100 พอดี? มากหรือน้อยกว่านี้ได้ไหม?',
      answer:
        'มาจาก **ทฤษฎีบท Nyquist**: ถ้าจะเก็บเสียงความถี่สูงสุด $f$ ได้ครบ ต้องสุ่มอย่างน้อย $2f$ ครั้ง/วินาที\n\n' +
        'หูคนได้ยินสูงสุด ~20,000 Hz ดังนั้นต้องสุ่ม > 40,000 ครั้ง/วินาที เลือก 44,100 เผื่อขอบไว้นิดหน่อย ' +
        'ถ้าสุ่มน้อยกว่านี้ เสียงสูงจะเพี้ยน (aliasing)',
    },
  ],
);

// English example: why the sky is blue.
const englishSky = buildLearnFixture(
  'example-en-sky',
  'Why is the sky blue? (example)',
  1,
  [
    {
      md:
        '## Sunlight is many colors at once\n\nWhite sunlight is really a **mix of every color**, ' +
        'each with a different wavelength — red is long, blue and violet are short.\n\n' +
        'If nothing got in the way, the sky would just look like the Sun on a black background. ' +
        'So what does the air do to the light?',
    },
    {
      md:
        '## Air scatters light\n\nAir is full of tiny molecules. When light hits them it gets ' +
        '**scattered** — bounced off in all directions. This is called *Rayleigh scattering*.\n\n' +
        'The key fact: **shorter wavelengths scatter much more** than longer ones.',
    },
    {
      md:
        '## Blue wins\n\nBecause blue light has a short wavelength, it scatters far more than red. ' +
        'That scattered blue light comes at your eyes from **every direction in the sky**.\n\n' +
        'Red light mostly passes straight through, which is why sunsets — seen through much more air — look red.',
    },
    {
      md:
        '## Putting it together\n\nSo the sky is blue because the air scatters short-wavelength ' +
        'blue light across the whole sky, and your eye catches it from all directions.\n\n' +
        'First principles: **white light + wavelength-dependent scattering = a blue sky**.',
    },
  ],
  [
    {
      chunkIndex: 1,
      anchor: 'shorter wavelengths scatter much more',
      question: 'why do shorter wavelengths scatter more?',
      answer:
        'Rayleigh scattering strength grows as $1/\\lambda^4$ — inversely with the **fourth power** of wavelength.\n\n' +
        'Blue (~450 nm) vs red (~650 nm): $(650/450)^4 \\approx 4.4$, so blue scatters about **4 times** as much. ' +
        'That steep power is why the effect is so lopsided toward blue.',
    },
  ],
);

export type Example = { id: string; label: string; data: SessionExport };

// The Japanese compound-interest session remains the default (seeded when the
// DB is empty). These are additional examples the learner can load.
export const examples: Example[] = [
  { id: fixture.session.id, label: '複利のきほん (JP)', data: fixture },
  { id: thaiMp3.session.id, label: 'MP3 ทำงานยังไง (TH)', data: thaiMp3 },
  { id: englishSky.session.id, label: 'Why is the sky blue? (EN)', data: englishSky },
  { id: fireFixture.session.id, label: 'FIRE 逆算デモ (gyakusan)', data: fireFixture },
];
