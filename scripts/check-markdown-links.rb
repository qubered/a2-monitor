#!/usr/bin/env ruby
# frozen_string_literal: true

errors = []

Dir.glob("**/*.md", File::FNM_DOTMATCH).sort.each do |file|
  next if file.start_with?(".git/", "node_modules/", "dist/", "build/", "target/")

  File.read(file).scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw|
    link = raw.strip.delete_prefix("<").delete_suffix(">")
    next if link.match?(%r{^(https?://|mailto:|#)})

    path = link.split("#", 2).first
    next if path.nil? || path.empty?

    target = File.expand_path(path, File.dirname(file))
    errors << "#{file}: missing local link target #{link}" unless File.exist?(target)
  end
end

abort(errors.join("\n")) unless errors.empty?

puts "Local Markdown links passed."
