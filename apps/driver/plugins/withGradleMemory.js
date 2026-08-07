const { withGradleProperties } = require("expo/config-plugins");

const PROPERTIES = [
  {
    type: "property",
    key: "org.gradle.jvmargs",
    value: "-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8",
  },
  { type: "property", key: "org.gradle.workers.max", value: "2" },
];

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => item.type !== "property" || !PROPERTIES.some((property) => property.key === item.key),
    );
    cfg.modResults.push(...PROPERTIES);
    return cfg;
  });
};
