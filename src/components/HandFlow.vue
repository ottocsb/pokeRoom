<script setup lang="ts">
import { computed } from 'vue';
import { type Card, isRed, rankLabel, SUIT_SYMBOL } from '../cards';
import { streetsOf } from '../handlog';
import type { HandAction } from '../protocol';

const props = defineProps<{ actions: HandAction[]; board: Card[]; nameOf: (seat: number) => string }>();
const streets = computed(() => streetsOf(props.actions, props.board, props.nameOf));
const cardText = (c: Card) => rankLabel(c.r) + SUIT_SYMBOL[c.s];
</script>

<template>
  <div v-for="s in streets" :key="s.label" class="hist-street">
    <div class="st">
      {{ s.label }}
      <i v-for="(c, k) in s.cards" :key="k" class="hcard" :class="{ red: isRed(c) }">{{ cardText(c) }}</i>
    </div>
    <div v-for="(a, k) in s.acts" :key="k" class="hist-act" :class="{ fold: a.fold }">
      <span class="nm">{{ a.who }}</span>{{ a.text }}
    </div>
  </div>
</template>
