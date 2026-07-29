import assert from 'node:assert/strict';
import test from 'node:test';
import {whisperModelRank} from '../scripts/lib/whisper-discovery.mjs';

test('Whisper 自动发现优先选择更高精度的本地模型', () => {
  assert.ok(whisperModelRank('/models/faster-whisper-large-v3') > whisperModelRank('/models/faster-whisper-medium'));
  assert.ok(whisperModelRank('/models/faster-whisper-medium') > whisperModelRank('/models/faster-whisper-small'));
  assert.ok(whisperModelRank('/models/faster-whisper-small') > whisperModelRank('/models/faster-whisper-base'));
});
