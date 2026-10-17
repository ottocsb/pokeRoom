<script setup lang="ts">
import { type Card, cardKey, isRed, rankLabel, SUIT_SYMBOL } from '../cards';
import { fresh } from '../store';

const props = withDefaults(defineProps<{ card: Card | null; k: string; cls?: string; delay?: number }>(), { cls: '', delay: 0 });
// decided once when the element is created, like the old innerHTML renderer
const isFresh = fresh(props.k);
</script>

<template>
  <div v-if="!card" class="card back" :class="[{ fresh: isFresh }, cls]" :style="{ '--d': `${delay}ms` }"></div>
  <div
    v-else
    class="card face"
    :class="[isRed(card) ? 'red' : 'black', { fresh: isFresh }, cls]"
    :style="{ '--d': `${delay}ms` }"
    :data-card="cardKey(card)"
  >
    <span class="corner"
      ><b>{{ rankLabel(card.r) }}</b><i>{{ SUIT_SYMBOL[card.s] }}</i></span
    ><span class="pip">{{ SUIT_SYMBOL[card.s] }}</span>
  </div>
</template>
