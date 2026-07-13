<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

const props = defineProps<{ config: ChartConfiguration; height?: number }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

function render() {
  if (!canvas.value) return;
  // Same chart type → update in place, so data changes animate instead of flashing a rebuild.
  const config = chart?.config as ChartConfiguration | undefined;
  if (chart && config && config.type === props.config.type) {
    config.data = props.config.data;
    if (props.config.options) config.options = props.config.options;
    chart.update();
    return;
  }
  chart?.destroy();
  chart = new Chart(canvas.value, props.config);
}

onMounted(render);
watch(() => props.config, render, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div :style="{ height: `${height ?? 240}px` }">
    <canvas ref="canvas" />
  </div>
</template>
