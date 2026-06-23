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

    <template v-else-if="name === 'home'">
      <path d="M4 11.5 12 5l8 6.5"></path>
      <path d="M6.5 10.5v8h11v-8"></path>
      <path d="M10 18.5v-5h4v5"></path>
    </template>

    <template v-else-if="name === 'dictionary'">
      <path d="M5.5 4.5h11A2.5 2.5 0 0 1 19 7v12.5H7.5A2.5 2.5 0 0 1 5 17V7a2.5 2.5 0 0 1 2.5-2.5"></path>
      <path d="M8 4.5v15"></path>
      <path d="M11 8h4"></path>
      <path d="M11 11h3"></path>
    </template>

    <template v-else-if="name === 'dojo'">
      <path d="M4 19.5h16"></path>
      <path d="M6.5 19.5v-6.2L12 8l5.5 5.3v6.2"></path>
      <path d="M9.2 19.5v-4h5.6v4"></path>
      <path d="M7 8.4 12 4l5 4.4"></path>
    </template>

    <template v-else-if="name === 'login'">
      <path d="M10 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H10"></path>
      <path d="M10 12h10"></path>
      <polyline points="15 7 20 12 15 17"></polyline>
    </template>

    <template v-else-if="name === 'logout'">
      <path d="M14 6h3.5A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5H14"></path>
      <path d="M14 12H4"></path>
      <polyline points="9 7 4 12 9 17"></polyline>
    </template>

    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19 12a7.2 7.2 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5A7.2 7.2 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"></path>
    </template>

    <template v-else-if="name === 'save'">
      <path d="M5 4.5h11.2L19 7.3v12.2H5z"></path>
      <path d="M8 4.5v5h7v-5"></path>
      <path d="M8 19.5v-6h8v6"></path>
    </template>

    <template v-else-if="name === 'lock'">
      <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
      <path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10"></path>
      <path d="M12 14v2"></path>
    </template>

    <template v-else-if="name === 'hourglass'">
      <path d="M7 4.5h10"></path>
      <path d="M7 19.5h10"></path>
      <path d="M8 4.5v3.2c0 1 .5 1.9 1.3 2.5L12 12l2.7-1.8c.8-.6 1.3-1.5 1.3-2.5V4.5"></path>
      <path d="M8 19.5v-3.2c0-1 .5-1.9 1.3-2.5L12 12l2.7 1.8c.8.6 1.3 1.5 1.3 2.5v3.2"></path>
    </template>

    <template v-else-if="name === 'trophy'">
      <path d="M8 4.5h8v4.8a4 4 0 0 1-8 0z"></path>
      <path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.8 4"></path>
      <path d="M16 6.5h2.5a2.5 2.5 0 0 1-2.8 4"></path>
      <path d="M12 13.5v3.2"></path>
      <path d="M8.5 19.5h7"></path>
      <path d="M10 16.7h4"></path>
    </template>

    <template v-else-if="name === 'star'">
      <path d="M12 4.3l2.3 4.6 5.1.7-3.7 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.7-3.6 5.1-.7z"></path>
    </template>

    <template v-else-if="name === 'flame'">
      <path d="M12.5 21a6 6 0 0 0 5.8-6.1c0-3.5-2.2-5.8-5.2-9.9-.4 2.4-1.5 4-3.1 5.4-.9.8-2.3 2.1-2.3 4.5A4.8 4.8 0 0 0 12.5 21z"></path>
      <path d="M12 18a2.4 2.4 0 0 0 2.2-2.5c0-1.1-.6-2-1.7-3.4-.2 1-.7 1.6-1.4 2.2-.4.4-.8.9-.8 1.6A1.8 1.8 0 0 0 12 18z"></path>
    </template>

    <template v-else-if="name === 'github'">
      <path d="M9 19.5c-4 1.2-4-2-5.6-2.4"></path>
      <path d="M15 21v-3.2c0-.9.3-1.5.7-1.9-2.4-.3-4.9-1.2-4.9-5.3a4.1 4.1 0 0 1 1.1-2.9 3.8 3.8 0 0 1 .1-2.8s.9-.3 2.9 1.1a10 10 0 0 1 5.2 0C22.1 4.6 23 4.9 23 4.9a3.8 3.8 0 0 1 .1 2.8 4.1 4.1 0 0 1 1.1 2.9c0 4.1-2.5 5-4.9 5.3.5.4.8 1.2.8 2.3V21"></path>
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
