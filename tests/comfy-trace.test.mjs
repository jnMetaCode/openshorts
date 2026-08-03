import test from 'node:test';
import assert from 'node:assert/strict';
import {extractComfyTrace, isReproducible} from '../shared/comfy-trace.mjs';

// ComfyUI「Save (API Format)」导出的典型结构：节点用 [id, slot] 二元组连线。
const workflow = {
  '3': {class_type: 'KSampler', inputs: {
    seed: 987654321, steps: 28, cfg: 7.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
    model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
  }},
  '4': {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'flux1-dev.safetensors'}},
  '5': {class_type: 'EmptyLatentImage', inputs: {width: 1024, height: 1536, batch_size: 1}},
  '6': {class_type: 'CLIPTextEncode', inputs: {text: '剪纸风格弓箭手，纯绿背景，全身', clip: ['4', 1]}},
  '7': {class_type: 'CLIPTextEncode', inputs: {text: '文字，水印，裁切', clip: ['4', 1]}},
  '9': {class_type: 'SaveImage', inputs: {filename_prefix: 'openshorts', images: ['8', 0]}},
};

test('从工作流解析出模型、种子和正向提示词', () => {
  const trace = extractComfyTrace(workflow);
  assert.equal(trace.provider, 'comfyui');
  assert.equal(trace.model, 'flux1-dev.safetensors');
  assert.equal(trace.seed, 987654321);
  assert.equal(trace.prompt, '剪纸风格弓箭手，纯绿背景，全身');
});

test('正负提示词按采样器的连线区分，不会搞反', () => {
  const trace = extractComfyTrace(workflow);
  assert.equal(trace.prompt, '剪纸风格弓箭手，纯绿背景，全身');
  assert.equal(trace.parameters.negativePrompt, '文字，水印，裁切');
});

test('采样参数和尺寸一并记录，用于复现', () => {
  const {parameters} = extractComfyTrace(workflow);
  assert.equal(parameters.steps, 28);
  assert.equal(parameters.cfg, 7.5);
  assert.equal(parameters.sampler_name, 'dpmpp_2m');
  assert.equal(parameters.scheduler, 'karras');
  assert.equal(parameters.size, '1024x1536');
});

test('KSamplerAdvanced 用 noise_seed 字段', () => {
  const advanced = {
    '3': {class_type: 'KSamplerAdvanced', inputs: {noise_seed: 42, steps: 20, model: ['4', 0], positive: ['6', 0]}},
    '4': {class_type: 'UNETLoader', inputs: {unet_name: 'flux1-schnell.safetensors'}},
    '6': {class_type: 'CLIPTextEncode', inputs: {text: '测试'}},
  };
  const trace = extractComfyTrace(advanced);
  assert.equal(trace.seed, 42);
  assert.equal(trace.model, 'flux1-schnell.safetensors');
});

test('提示词经过中间节点时能继续往上游找', () => {
  const chained = {
    '3': {class_type: 'KSampler', inputs: {seed: 1, positive: ['10', 0], model: ['4', 0]}},
    '4': {class_type: 'CheckpointLoaderSimple', inputs: {ckpt_name: 'm.safetensors'}},
    '10': {class_type: 'ConditioningCombine', inputs: {text: ['6', 0]}},
    '6': {class_type: 'CLIPTextEncode', inputs: {text: '上游提示词'}},
  };
  assert.equal(extractComfyTrace(chained).prompt, '上游提示词');
});

test('连线值不会被当成字面参数写进溯源', () => {
  const trace = extractComfyTrace(workflow);
  for (const value of Object.values(trace.parameters)) assert.ok(!Array.isArray(value), '连线不应出现在参数里');
  assert.equal(trace.seed, 987654321);
});

test('空工作流或异常输入不抛错', () => {
  for (const input of [null, undefined, {}, {a: null}]) {
    const trace = extractComfyTrace(input);
    assert.equal(trace.provider, 'comfyui');
    assert.equal(trace.model, 'unknown');
  }
});

test('缺模型或种子时判定为不可复现', () => {
  assert.equal(isReproducible(extractComfyTrace(workflow)), true);
  assert.equal(isReproducible({model: 'unknown', seed: 1}), false);
  assert.equal(isReproducible({model: 'x'}), false);
});
