<template>
  <svg :viewBox="viewBox" class="icon" :class="$attrs.class" aria-hidden="true">
    <template v-if="name === 'search'">
      <circle cx="11" cy="11" r="6.5"></circle>
      <line x1="16" y1="16" x2="21" y2="21"></line>
    </template>

    <template v-else-if="name === 'volume'">
      <path d="M4 14h3l5 4V6L7 10H4z"></path>
      <path d="M16 9a5 5 0 0 1 0 6"></path>
      <path d="M18.5 6.5a8.5 8.5 0 0 1 0 11"></path>
    </template>

    <template v-else-if="name === 'check'">
      <polyline points="4 13 9 18 20 7"></polyline>
    </template>

    <template v-else-if="name === 'error'">
      <circle cx="12" cy="12" r="9"></circle>
      <line x1="8.5" y1="8.5" x2="15.5" y2="15.5"></line>
      <line x1="15.5" y1="8.5" x2="8.5" y2="15.5"></line>
    </template>

    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="8.5"></circle>
      <line x1="12" y1="12" x2="12" y2="7.8"></line>
      <line x1="12" y1="12" x2="15.5" y2="13.8"></line>
    </template>

    <template v-else-if="name === 'sparkles'">
      <path d="M12 3.8l1.7 4.2 4.1 1.7-4.1 1.7-1.7 4.2-1.7-4.2-4.1-1.7 4.1-1.7z"></path>
      <path d="M18.6 14.8l0.9 2.2 2.1 0.9-2.1 0.9-0.9 2.2-0.9-2.2-2.1-0.9 2.1-0.9z"></path>
    </template>

    <template v-else-if="name === 'chat'">
      <path d="M5 6.5h14v9.5H10l-4.5 3V6.5z"></path>
    </template>

    <template v-else-if="name === 'brain'">
      <path d="M9 7a3 3 0 0 1 6 0v10a3 3 0 0 1-6 0z"></path>
      <path d="M9 9H7a2 2 0 0 0 0 4h2"></path>
      <path d="M15 9h2a2 2 0 0 1 0 4h-2"></path>
    </template>

    <template v-else-if="name === 'book'">
      <path d="M4.5 6.5h7.5a2 2 0 0 1 2 2v9H6.5a2 2 0 0 0-2 2V6.5z"></path>
      <path d="M19.5 6.5H12a2 2 0 0 0-2 2v9h7.5a2 2 0 0 1 2 2V6.5z"></path>
    </template>

    <template v-else-if="name === 'trash'">
      <path d="M5 7h14"></path>
      <path d="M9 7V5.6h6V7"></path>
      <path d="M8 7l0.8 11h6.4L16 7"></path>
      <line x1="10.5" y1="10" x2="10.8" y2="16"></line>
      <line x1="13.5" y1="10" x2="13.2" y2="16"></line>
    </template>

    <template v-else-if="name === 'chevron'">
      <polyline points="8 10 12 14 16 10"></polyline>
    </template>

    <template v-else-if="name === 'x'">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </template>

    <template v-else-if="name === 'arrow-up'">
      <line x1="12" y1="19" x2="12" y2="6"></line>
      <polyline points="6 11 12 5 18 11"></polyline>
    </template>

    <template v-else-if="name === 'arrow-right'">
      <line x1="5" y1="12" x2="18" y2="12"></line>
      <polyline points="12 6 18 12 12 18"></polyline>
    </template>

    <template v-else-if="name === 'plus'">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </template>

    <template v-else-if="name === 'minus'">
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </template>

    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4"></circle>
      <line x1="12" y1="3" x2="12" y2="5.5"></line>
      <line x1="12" y1="18.5" x2="12" y2="21"></line>
      <line x1="3" y1="12" x2="5.5" y2="12"></line>
      <line x1="18.5" y1="12" x2="21" y2="12"></line>
      <line x1="5.6" y1="5.6" x2="7.4" y2="7.4"></line>
      <line x1="16.6" y1="16.6" x2="18.4" y2="18.4"></line>
      <line x1="5.6" y1="18.4" x2="7.4" y2="16.6"></line>
      <line x1="16.6" y1="7.4" x2="18.4" y2="5.6"></line>
    </template>

    <template v-else-if="name === 'moon'">
      <path d="M20.5 14.2A8.2 8.2 0 1 1 10.3 3.6 6.4 6.4 0 0 0 20.5 14.2z"></path>
    </template>

    <template v-else-if="name === 'accessibility'">
      <circle cx="12" cy="4.6" r="1.7"></circle>
      <line x1="4.5" y1="8.4" x2="19.5" y2="8.4"></line>
      <path d="M12 8.4v6"></path>
      <path d="M8.8 20.5 12 14.4l3.2 6.1"></path>
    </template>
  </svg>
</template>

<script setup>
defineOptions({ inheritAttrs: false });

defineProps({
  name: {
    type: String,
    required: true
  },
  viewBox: {
    type: String,
    default: '0 0 24 24'
  }
});
</script>

<style scoped>
.icon {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
