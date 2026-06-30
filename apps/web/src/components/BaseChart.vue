<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

const props = defineProps<{ config: ChartConfiguration; height?: number }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

function render() {
  if (!canvas.value) return;
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
