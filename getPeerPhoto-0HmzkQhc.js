//# allFunctionsCalledOnLoad
import{r as e,t}from"./restrictions-Dq_9Cd3p.js";function n(n,r,i){let a=n?.restriction_reason;return a&&n.pFlags.restricted?(r&&(a=a.filter(e=>e.reason!==t)),e(a,i)):!1}function r(e,t){if(!e||n(e,!1,t))return;let r=e?.photo;if(r?._===`userProfilePhoto`||r?._===`chatPhoto`)return r}export{n,r as t};
//# sourceMappingURL=getPeerPhoto-0HmzkQhc.js.map