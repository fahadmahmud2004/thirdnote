import React from 'react';
import {Composition} from 'remotion';
import {Promo} from './Promo';
import {TOTAL} from './theme';

export const Root: React.FC = () => (
  <>
    {/* Chrome Web Store / YouTube promo video */}
    <Composition id="Promo16x9" component={Promo} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
  </>
);
