import Room from "./room.js"
import Home from "./home.js"
// import {runAllTests} from "./lib/test_document.js";

// Such a weird import is required for pure js templates
// See https://jvns.ca/blog/2021/11/15/esbuild-vue/ for details
// noinspection JSFileReferences
import {createApp} from "vue/dist/vue.esm-bundler.js";

import {createRouter, createWebHistory, RouterView} from "vue-router";

const app = createApp({
    template: `
      <RouterView/>
    `,
    components: {
        Room,
        RouterView
    },
    mounted() {
        // runAllTests()
        document.getElementById("app").classList.add("mounted");
    }
})

const routes = [
    {
        path: '/', component: Home,
        props: route => ({errorCode: route.query.errorCode})
    },
    {path: '/room/:roomId', component: Room, props: true},
    {path: '/room/:roomId.:extension', component: Room, props: true},
]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

app
    .use(router)
    .mount('#app')