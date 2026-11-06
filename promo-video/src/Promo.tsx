import React from 'react';
import {AbsoluteFill, Audio, Sequence, Series, staticFile} from 'remotion';
import {C, SCENES} from './theme';
import {Wipe} from './kit';
import {BoardScene, End, Feature, FeatureProps, Hits, Lost, Roll, Snap, WriteScene} from './scenes';

// Camera, cursor and crop boxes are in the captures' CSS pixels (1440x900).
const CAPTURE: FeatureProps = {
  scene: 'capture',
  num: '01',
  label: 'Capture',
  title: 'Screenshots that never get lost.',
  mark: 'never',
  chips: [{text: 'Any part of the screen', dot: C.marker}, {text: 'Add a note', dot: C.blue}, {text: 'Video timestamps', dot: C.red}, {text: 'Straight to a collection', dot: C.green}],
  url: 'any website',
  shots: [{at: 0, src: 'web-saved'}, {at: 60, src: 'capture-drag'}, {at: 66, src: 'capture-card'}],
  rect: {from: 28, to: 60, x1: 330, y1: 60, x2: 1100, y2: 330},
  cam: {
    z: [[0, 1.05], [70, 1], [92, 1.35], [150, 1.4]],
    x: [[0, 720], [92, 900]],
    y: [[0, 420], [92, 580]],
  },
  cursor: {path: [[14, 760, 520], [28, 330, 60], [60, 1100, 330], [104, 1160, 745]], clicks: [28, 62, 122]},
};

const HIGHLIGHT: FeatureProps = {
  scene: 'highlight',
  num: '02',
  label: 'Highlight',
  title: 'Keep the answers that matter.',
  mark: 'matter',
  chips: [{text: 'Four colours', dot: C.marker}, {text: 'Keys 1 to 4', dot: C.red}, {text: 'Whole chats saved', dot: C.green}],
  url: 'your AI chat',
  shots: [
    {at: 0, src: 'chat-plain'},
    {at: 36, src: 'chat-select'},
    {at: 66, src: 'chat-first-hl'},
    {at: 96, src: 'chat-toolbar'},
    {at: 124, src: 'chat-saved'},
  ],
  cam: {
    z: [[0, 1.05], [28, 1.55], [100, 1.5], [150, 1.2]],
    x: [[0, 760], [28, 840], [100, 860], [150, 900]],
    y: [[0, 300], [28, 230], [100, 300], [150, 380]],
  },
  cursor: {
    path: [[14, 1180, 640], [26, 650, 207], [40, 1016, 207], [80, 980, 400], [92, 561, 320], [104, 985, 320], [130, 1250, 600]],
    clicks: [74, 124],
    hideAt: 140,
  },
};

const REVIEW: FeatureProps = {
  scene: 'review',
  num: '05',
  label: 'Review',
  title: 'Remember it with flashcards.',
  mark: 'Remember',
  chips: [{text: 'Your questions become prompts', dot: C.marker}, {text: 'Recall, then reveal', dot: C.green}],
  url: 'ThirdNote  ·  Review',
  shots: [{at: 0, src: 'review-front'}, {at: 64, src: 'review-back'}, {at: 126, src: 'review-done'}],
  flip: 64,
  cam: {z: [[0, 1], [34, 1.25], [150, 1.28]], x: [[0, 720]], y: [[0, 470]]},
  cursor: {path: [[84, 1120, 760], [112, 814, 516]], clicks: [122], hideAt: 140},
};

const ORDER: [string, React.ReactNode][] = [
  ['roll', <Roll />],
  ['lost', <Lost />],
  ['snap', <Snap />],
  ['capture', <Feature {...CAPTURE} />],
  ['highlight', <Feature {...HIGHLIGHT} />],
  ['board', <BoardScene />],
  ['write', <WriteScene />],
  ['review', <Feature {...REVIEW} />],
  ['hits', <Hits />],
  ['end', <End />],
];

// Cuts that get a marker wipe.
const WIPES = new Set(['capture', 'highlight', 'board', 'write', 'review', 'end']);

export const Promo: React.FC = () => {
  let at = 0;
  const wipes: React.ReactNode[] = [];
  for (const [name] of ORDER) {
    if (WIPES.has(name)) wipes.push(<Sequence key={name} from={at - 10} durationInFrames={22}><Wipe color={name === 'end' ? C.navy : C.marker} /></Sequence>);
    at += SCENES[name];
  }
  return (
    <AbsoluteFill style={{background: C.night}}>
      <Series>
        {ORDER.map(([name, node]) => (
          <Series.Sequence key={name} durationInFrames={SCENES[name]}>
            {node}
          </Series.Sequence>
        ))}
      </Series>
      {wipes}
      <Audio src={staticFile('score.wav')} />
    </AbsoluteFill>
  );
};
