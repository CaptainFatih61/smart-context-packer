<template>
  <div class="user-card">
    <h2>{{ formattedName }}</h2>
    <p>{{ user.email }}</p>
  </div>
</template>

<script setup lang="ts">
import type { User } from '@/models/user.js';
import { formatGreeting } from '@/utils/helpers.js';

const props = defineProps<{
  user: User;
}>();

const formattedName = formatGreeting(props.user.username);
</script>

<style scoped>
.user-card {
  padding: 1rem;
  border-radius: 8px;
}
</style>
