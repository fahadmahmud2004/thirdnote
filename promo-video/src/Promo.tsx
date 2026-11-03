import React from 'react';
import {AbsoluteFill, Audio, Series, staticFile} from 'remotion';
import {C, SCENES} from './theme';
import {End, Extras, Feature, FeatureProps, Flood, LogoScene, Mark} from './scenes';

// Camera, cursor and crop boxes are in the captures' CSS pixels (1440x900).
const HIGHLIGHT: FeatureProps = {
  scene: 'highlight',
  num: '01',
  label: 'Highlight',
  title: ['Mark what ', 'matters', ', in one tap.'],
  chips: [{text: 'Four colours', dot: C.marker}, {text: 'Keys 1 to 4', dot: C.red}, {text: 'Add a note', dot: C.blue}],
  url: 'chatgpt.com',
  shots: [
    {at: 0, src: 'chat-plain'},
    {at: 40, src: 'chat-select'},
    {at: 78, src: 'chat-first-hl'},
    {at: 110, src: 'chat-toolbar'},
    {at: 128, src: 'chat-saved'},
  ],
  cam: {
    z: [[0, 1], [32, 1.45], [104, 1.45], [150, 1.2], [210, 1.12]],
    x: [[0, 760], [32, 850], [104, 860], [150, 900]],
    y: [[0, 300], [32, 250], [104, 300], [150, 420]],
  },
  cursor: {
    path: [[18, 1180, 640], [30, 650, 207], [44, 1016, 207], [68, 943, 250], [92, 561, 320], [106, 985, 320], [120, 1010, 362]],
    clicks: [74, 124],
    hideAt: 150,
  },
};

const AI = [
  {text: 'ChatGPT', dot: '#10a37f'},
  {text: 'Claude', dot: '#d97757'},
  {text: 'Gemini', dot: '#4f7df3'},
  {text: 'NotebookLM', dot: '#8b93a7'},
  {text: 'DeepSeek', dot: '#4d6bfe'},
  {text: 'Perplexity', dot: '#20b8cd'},
  {text: 'Grok', dot: '#6b7280'},
  {text: 'Copilot', dot: '#2b88d8'},
  {text: 'Le Chat', dot: '#e2662d'},
  {text: 'Poe', dot: '#5d4bd8'},
  {text: 'Qwen', dot: '#6a4beb'},
  {text: 'Kimi', dot: '#222831'},
  {text: 'Meta AI', dot: '#0668e1'},
];

const CHATS: FeatureProps = {
  scene: 'chats',
  num: '02',
  label: 'Save chats',
  title: ['Whole chats, saved ', 'automatically', '.'],
  chips: [{text: 'Updates as you chat', dot: C.green}, {text: 'Import shared links', dot: C.blue}],
  url: 'chatgpt.com',
  shots: [{at: 0, src: 'chat-saved'}, {at: 74, src: 'chat-menu'}],
  cam: {
    z: [[0, 1.1], [40, 1.55], [165, 1.6]],
    x: [[0, 1000], [40, 1300]],
    y: [[0, 600], [40, 700]],
  },
  cursor: {path: [[26, 940, 560], [62, 1341, 786]], clicks: [70]},
  marquee: AI,
};

const COLLECT: FeatureProps = {
  scene: 'collect',
  num: '03',
  label: 'Collect',
  title: ['Collect from ', 'anywhere', '.'],
  chips: [
    {text: 'YouTube', dot: '#ff3d3d'},
    {text: 'Facebook', dot: '#1877f2'},
    {text: 'Wikipedia', dot: '#9aa3b5'},
    {text: 'Any website', dot: C.marker},
  ],
  url: 'en.wikipedia.org/wiki/Photosynthesis',
  shots: [{at: 0, src: 'web-toolbar'}, {at: 54, src: 'web-saved'}],
  cam: {
    z: [[0, 1], [30, 1.45], [110, 1.45], [180, 1.25]],
    x: [[0, 520]],
    y: [[0, 210]],
  },
  cursor: {path: [[22, 820, 520], [44, 509, 178]], clicks: [50], hideAt: 90},
  panel: {at: 76, shots: [{at: 0, src: 'panel-library'}, {at: 128, src: 'panel-highlights'}]},
};

const CAPTURE: FeatureProps = {
  scene: 'capture',
  num: '04',
  label: 'Capture',
  title: ['Capture ', 'any part', ' of the screen.'],
  chips: [{text: 'Alt + Shift + S', dot: C.marker}, {text: 'YouTube timestamps', dot: '#ff3d3d'}, {text: 'Add a note', dot: C.blue}],
  url: 'en.wikipedia.org/wiki/Photosynthesis',
  shots: [{at: 0, src: 'web-saved'}, {at: 60, src: 'capture-drag'}, {at: 66, src: 'capture-card'}],
  rect: {from: 28, to: 60, x1: 330, y1: 60, x2: 1100, y2: 330},
  cam: {
    z: [[0, 1], [70, 1], [92, 1.3], [165, 1.32]],
    x: [[0, 720], [92, 860]],
    y: [[0, 420], [92, 560]],
  },
  cursor: {path: [[14, 760, 520], [28, 330, 60], [60, 1100, 330], [104, 900, 590]], clicks: [28, 62, 122]},
};

const READ: FeatureProps = {
  scene: 'read',
  num: '05',
  label: 'Read',
  title: ['Read it like ', 'clean notes', '.'],
  chips: [{text: 'Math & code kept', dot: C.green}, {text: 'Markdown & PDF export', dot: C.blue}],
  url: 'ThirdNote  ·  Reader',
  shots: [{at: 0, src: 'reader'}, {at: 76, src: 'reader-highlights'}],
  cam: {z: [[0, 1], [135, 1.12]], x: [[0, 720]], y: [[0, 260]]},
};

const REVIEW: FeatureProps = {
  scene: 'review',
  num: '06',
  label: 'Review',
  title: ['', 'Remember', ' it with flashcards.'],
  chips: [{text: 'Your questions become prompts', dot: C.marker}, {text: 'Recall, then reveal', dot: C.green}, {text: 'Space, 1, 2', dot: C.blue}],
  url: 'ThirdNote  ·  Review',
  shots: [{at: 0, src: 'review-front'}, {at: 64, src: 'review-back'}, {at: 126, src: 'review-done'}],
  flip: 64,
  cam: {z: [[0, 1], [34, 1.22], [180, 1.22]], x: [[0, 720]], y: [[0, 470]]},
  cursor: {path: [[84, 1120, 760], [112, 814, 516]], clicks: [122], hideAt: 140},
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{background: C.night}}>
    <Series>
      <Series.Sequence durationInFrames={SCENES.flood}>
        <Flood />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENES.mark}>
        <Mark />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENES.logo}>
        <LogoScene />
      </Series.Sequence>
      {[HIGHLIGHT, CHATS, COLLECT, CAPTURE, READ, REVIEW].map((p) => (
        <Series.Sequence key={p.scene} durationInFrames={SCENES[p.scene]}>
          <Feature {...p} />
        </Series.Sequence>
      ))}
      <Series.Sequence durationInFrames={SCENES.extras}>
        <Extras />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENES.end}>
        <End />
      </Series.Sequence>
    </Series>
    <Audio src={staticFile('score.wav')} />
  </AbsoluteFill>
);
